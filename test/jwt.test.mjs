/**
 * JWT 签名单元测试：现场生成假密钥（绝不使用真实 .p8）。
 *
 * 用 node:crypto 的 EC P-256 密钥对签名，再独立验签，确认
 * `makeToken` 产出的 header/payload/ES256 签名符合 Apple 的要求。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createHash, verify as cryptoVerify } from 'node:crypto'
import { makeToken } from '../lib/asc/jwt.js'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

/** @param {string} part - base64url 段。 @returns {object} 解码后的 JSON。 */
function decodePart(part) {
	return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

test('makeToken 产出可独立验签的 ES256 JWT', () => {
	const now = 1_700_000_000_000
	const { token } = makeToken({ p8: P8, keyId: 'ABC123DEFG', issuerId: '57246542-96fe-1a63-e053-0824d011072a', now })
	const [headerPart, payloadPart, signaturePart] = token.split('.')
	assert.equal(token.split('.').length, 3)

	const header = decodePart(headerPart)
	const payload = decodePart(payloadPart)
	assert.equal(header.alg, 'ES256')
	assert.equal(header.kid, 'ABC123DEFG')
	assert.equal(header.typ, 'JWT')
	assert.equal(payload.iss, '57246542-96fe-1a63-e053-0824d011072a')
	assert.equal(payload.aud, 'appstoreconnect-v1')

	// exp - iat 不得超过 20 分钟（Apple 要求）。
	assert.ok(payload.exp - payload.iat <= 20 * 60)
	assert.ok(payload.exp - payload.iat >= 19 * 60 - 1)

	// 独立验签：签名必须是 64 字节 r||s（ieee-p1363）。
	const signature = Buffer.from(signaturePart, 'base64url')
	assert.equal(signature.length, 64)
	const valid = cryptoVerify('sha256', Buffer.from(`${headerPart}.${payloadPart}`), {
		key: publicKey,
		dsaEncoding: 'ieee-p1363'
	}, signature)
	assert.equal(valid, true)
})

test('篡改 payload 后验签失败', () => {
	const { token } = makeToken({ p8: P8, keyId: 'ABC123DEFG', issuerId: 'issuer' })
	const [headerPart, , signaturePart] = token.split('.')
	const forgedPayload = Buffer.from(JSON.stringify({ iss: 'attacker' })).toString('base64url')
	const signature = Buffer.from(signaturePart, 'base64url')
	const valid = cryptoVerify('sha256', Buffer.from(`${headerPart}.${forgedPayload}`), {
		key: publicKey,
		dsaEncoding: 'ieee-p1363'
	}, signature)
	assert.equal(valid, false)
})

test('iat 带时钟偏移、expiresAt 落在缓存窗口内', () => {
	const now = Date.now()
	const { expiresAt, iat } = makeToken({ p8: P8, keyId: 'K', issuerId: 'I', now })
	assert.ok(Math.abs(iat * 1000 - (now - 30_000)) < 2_000)
	const drift = expiresAt - now
	assert.ok(drift > 18 * 60 * 1000 && drift <= 19.5 * 60 * 1000, `expiresAt 偏移 ${drift}ms 不合理`)
})

test('缺少 Key ID / Issuer ID / 私钥时抛 CONFIG 错误', () => {
	assert.throws(() => makeToken({ p8: P8, issuerId: 'i' }), (error) => error.code === 'CONFIG')
	assert.throws(() => makeToken({ p8: P8, keyId: 'k' }), (error) => error.code === 'CONFIG')
	assert.throws(() => makeToken({ p8: 'not a key', keyId: 'k', issuerId: 'i' }), (error) => error.code === 'CONFIG')
})

test('jti 可注入（相同参数产出相同声明）', () => {
	const fixed = createHash('sha256').update('fixed').digest('hex')
	// ES256 签名默认随机化，token 串不会逐字节相同；比较声明即可。
	const first = makeToken({ p8: P8, keyId: 'K', issuerId: 'I', now: 1_700_000_000_000, jti: fixed })
	const second = makeToken({ p8: P8, keyId: 'K', issuerId: 'I', now: 1_700_000_000_000, jti: fixed })
	const [firstPayload, secondPayload] = [first, second].map((entry) =>
		JSON.parse(Buffer.from(entry.token.split('.')[1], 'base64url').toString('utf8')))
	assert.deepEqual(secondPayload, firstPayload)
	assert.equal(secondPayload.jti, fixed)
})
