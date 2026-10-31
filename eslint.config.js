export default [{
	files: ['lib/**/*.js', 'test/**/*.mjs', 'support/**/*.mjs'],
	languageOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
		globals: Object.fromEntries([
			'Buffer', 'process', 'URL', 'AbortController', 'AbortSignal', 'fetch', 'Response',
			'setTimeout', 'clearTimeout', 'console', 'window', 'navigator', 'document',
			'FileReader', 'Image', 'createImageBitmap', 'structuredClone'
		].map((name) => [name, 'readonly']))
	},
	rules: { 'no-undef': 'error', 'no-unreachable': 'error', 'valid-typeof': 'error' }
}]
