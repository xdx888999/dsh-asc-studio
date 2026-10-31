/**
 * App Store Connect API 的 JWT 签名（ES256）。
 *
 * 不引入 `jose` 等第三方依赖：用 Node 内置 `crypto` 完成 ES256 签名，
 * `dsaEncoding: 'ieee-p1363'` 直接产出 JWT 要求的 64 字节 r||s 原始签名。
 *
 * @module dsh-asc-studio/asc/jwt
 */

import { createPrivateKey, sign as cryptoSign, randomUUID } from 'node:crypto'

/** token 有效期：20 秒钟偏移 + 19 分钟，满足 Apple “exp - iat ≤ 20 分钟”。 */
const TOKEN_TTL_MS = 19 * 60 * 1000
const CLOCK_SKEW_MS = 30 * 1000

/** @param {Uint8Array | string} value - 待编码字节。 @returns {string} 无填充 base64url。 */
function base64url(value) {
	return Buffer.from(value).toString('base64url')
}

/**
 * 校验并解析 .p8 私钥内容。
 * @param {string} p8 - PEM 内容（PKCS#8 EC 私钥）。
 * @returns {import('node:crypto').KeyObject} 私钥对象。
 */
function loadKey(p8) {
	const pem = String(p8 ?? '')
	if (!pem.includes('PRIVATE KEY')) {
		const error = new Error('.p8 内容不是有效的 PEM 私钥')
		error.code = 'CONFIG'
		throw error
	}
	try {
		return createPrivateKey(pem)
	} catch {
		const error = new Error('.p8 私钥无法解析，请确认下载的是椭圆曲线私钥（ES256）')
		error.code = 'CONFIG'
		throw error
	}
}

/**
 * 为 App Store Connect API 签一枚 JWT。
 *
 * header：`{ alg: "ES256", kid: <Key ID>, typ: "JWT" }`；
 * payload：`{ iss: <Issuer ID>, iat, exp, aud: "appstoreconnect-v1" }`。
 *
 * @param {object} options - 签名参数。
 * @param {string} options.p8 - .p8 私钥 PEM 内容。
 * @param {string} options.keyId - API 密钥的 Key ID。
 * @param {string} options.issuerId - API 密钥的 Issuer ID。
 * @param {number} [options.now] - 当前时间戳（毫秒），测试可注入。
 * @param {string} [options.jti] - 覆盖 jti（可选）。
 * @returns {{ token: string, expiresAt: number, iat: number, exp: number }}
 *   token 与过期信息（`expiresAt` 为毫秒时间戳）。
 */
export function makeToken({ p8, keyId, issuerId, now = Date.now(), jti } = {}) {
	if (typeof keyId !== 'string' || keyId === '') {
		const error = new Error('缺少 Key ID')
		error.code = 'CONFIG'
		throw error
	}
	if (typeof issuerId !== 'string' || issuerId === '') {
		const error = new Error('缺少 Issuer ID')
		error.code = 'CONFIG'
		throw error
	}
	const iat = Math.floor((now - CLOCK_SKEW_MS) / 1000)
	const exp = iat + Math.floor(TOKEN_TTL_MS / 1000)
	const header = { alg: 'ES256', kid: keyId, typ: 'JWT' }
	const payload = {
		iss: issuerId,
		iat,
		exp,
		aud: 'appstoreconnect-v1',
		jti: jti ?? randomUUID()
	}
	const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
	const key = loadKey(p8)
	const signature = cryptoSign('sha256', Buffer.from(signingInput, 'utf8'), {
		key,
		dsaEncoding: 'ieee-p1363'
	})
	return {
		token: `${signingInput}.${base64url(signature)}`,
		expiresAt: (exp + CLOCK_SKEW_MS / 1000) * 1000,
		iat,
		exp
	}
}
