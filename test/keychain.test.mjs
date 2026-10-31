import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { loadModule } from '../support/modules.mjs'

const SECRET = Buffer.from('synthetic keychain transport secret').toString('base64')

async function fixture({ error, output = '', stdinError = false, endThrows = false, spawnThrows = false } = {}) {
	const calls = []
	const module = await loadModule(resolve('lib/keychain.js'), {
		'node:child_process': { execFile: (file, args, options, callback) => {
			const call = { file, args: [...args], options, input: undefined, kills: 0 }
			calls.push(call)
			if (spawnThrows) throw new Error(`spawn failed with ${SECRET}`)
			const child = { stdin: new EventEmitter(), kill: () => { call.kills += 1 } }
			child.stdin.end = (input, complete) => {
				call.input = input
				if (endThrows) throw new Error(`stdin failed with ${SECRET}`)
				process.nextTick(() => {
					if (stdinError) child.stdin.emit('error', new Error(`broken pipe ${SECRET}`))
					complete()
					callback(error, output)
				})
			}
			if (args[0] !== '-i') process.nextTick(() => callback(error, output))
			return child
		} }
	})
	return { ...module, calls }
}

function assertSanitized(error, code = 'KEYCHAIN') {
	assert.equal(error.code, code)
	assert.equal(JSON.stringify(error).includes(SECRET), false)
	assert.equal(String(error.stack).includes(SECRET), false)
	assert.equal(error.cause, undefined)
	assert.equal(error.stdout, undefined)
	assert.equal(error.stderr, undefined)
	return true
}

test('sends a single bounded command only through stdin with a fixed security executable', async () => {
	const f = await fixture()
	await f.writeKeychain('dsh-asc:profile', 'p8:KEYA', SECRET)
	assert.equal(f.calls.length, 1)
	const call = f.calls[0]
	assert.equal(call.file, '/usr/bin/security')
	assert.deepEqual(call.args, ['-i', '-q', '-p', ''])
	assert.equal(call.options.timeout, 5000)
	assert.equal(call.options.env, undefined)
	assert.equal(call.options.shell, undefined)
	assert.equal(JSON.stringify({ args: call.args, options: call.options }).includes(SECRET), false)
	assert.equal(call.input, `add-generic-password -U -s "dsh-asc:profile" -a "p8:KEYA" -w ${SECRET}\n`)
	assert.equal(call.input.split('\n').length, 2)
	assert.ok(Buffer.byteLength(call.input) <= 4000)
})

test('quotes service names for the security parser without introducing another command', async () => {
	const f = await fixture()
	await f.writeKeychain('profile "quoted" \\ $(unused); data', 'p8:KEYA', SECRET)
	assert.ok(f.calls[0].input.includes('-s "profile \\"quoted\\" \\\\ $(unused); data"'))
	assert.equal(f.calls[0].input.split('\n').length, 2)
})

test('rejects command injection and malformed secret data before starting security', async () => {
	const f = await fixture()
	for (const service of ['profile\nhelp', 'profile\rhelp', 'profile\0help', '']) {
		await assert.rejects(f.writeKeychain(service, 'p8:KEYA', SECRET), assertSanitized)
	}
	for (const account of ['p8:KEYA\nhelp', 'p8:KEY A', 'p8:KEY"A', 'p8:' + 'A'.repeat(201)]) {
		await assert.rejects(f.writeKeychain('profile', account, SECRET), assertSanitized)
	}
	for (const secret of ['', `${SECRET}\nhelp error`, '"secret"', 'AA BB', 'AA\\BB']) {
		await assert.rejects(f.writeKeychain('profile', 'p8:KEYA', secret), assertSanitized)
	}
	assert.equal(f.calls.length, 0)
})

test('includes quoting expansion and UTF-8 bytes in the strict 4000-byte input limit', async () => {
	const f = await fixture()
	const overhead = Buffer.byteLength(`add-generic-password -U -s "" -a "p8:KEYA" -w ${SECRET}\n`)
	await f.writeKeychain('a'.repeat(4000 - overhead), 'p8:KEYA', SECRET)
	assert.equal(Buffer.byteLength(f.calls[0].input), 4000)
	await assert.rejects(f.writeKeychain('a'.repeat(4001 - overhead), 'p8:KEYA', SECRET), assertSanitized)
	await assert.rejects(f.writeKeychain('中'.repeat(1500), 'p8:KEYA', SECRET), assertSanitized)
	await assert.rejects(f.writeKeychain('"'.repeat(2000), 'p8:KEYA', SECRET), assertSanitized)
	await assert.rejects(f.writeKeychain('profile', 'p8:KEYA', 'A'.repeat(4000)), assertSanitized)
	assert.equal(f.calls.length, 1)
})

test('keeps read and delete arguments free of secrets and distinguishes missing items', async () => {
	const f = await fixture({ output: `${SECRET}\n` })
	assert.equal(await f.readKeychain('profile', 'p8:KEYA'), SECRET)
	await f.deleteKeychain('profile', 'p8:KEYA')
	assert.deepEqual(f.calls[0].args, ['find-generic-password', '-s', 'profile', '-a', 'p8:KEYA', '-w'])
	assert.deepEqual(f.calls[1].args, ['delete-generic-password', '-s', 'profile', '-a', 'p8:KEYA'])
	assert.ok(f.calls.every(({ file, input }) => file === '/usr/bin/security' && input === undefined))
	const missing = await fixture({ error: Object.assign(new Error(SECRET), { code: 44, stderr: SECRET }) })
	await assert.rejects(missing.readKeychain('profile', 'p8:KEYA'), (error) => assertSanitized(error, 'KEYCHAIN_NOT_FOUND'))
	await assert.rejects(missing.deleteKeychain('profile', 'p8:KEYA'), (error) => assertSanitized(error, 'KEYCHAIN_NOT_FOUND'))
	await assert.rejects(missing.writeKeychain('profile', 'p8:KEYA', SECRET), assertSanitized)
})

test('redacts process errors, timeouts, output overflow, and startup failures', async () => {
	for (const code of [1, 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ENOENT']) {
		const f = await fixture({ error: Object.assign(new Error(`Command failed ${SECRET}`), { code, stdout: SECRET, stderr: SECRET }), output: SECRET })
		await assert.rejects(f.writeKeychain('profile', 'p8:KEYA', SECRET), assertSanitized)
	}
	const f = await fixture({ spawnThrows: true })
	await assert.rejects(f.writeKeychain('profile', 'p8:KEYA', SECRET), assertSanitized)
})

test('fails closed and terminates the child when stdin fails even if its callback later succeeds', async () => {
	for (const options of [{ stdinError: true }, { endThrows: true }]) {
		const f = await fixture(options)
		await assert.rejects(f.writeKeychain('profile', 'p8:KEYA', SECRET), assertSanitized)
		assert.equal(f.calls[0].kills, 1)
	}
})

test('rejects empty keychain reads', async () => {
	const f = await fixture({ output: ' \n' })
	await assert.rejects(f.readKeychain('profile', 'p8:KEYA'), assertSanitized)
})
