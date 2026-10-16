# CommonJS compatibility adapter

Source: https://registry.npmjs.org/decode-uri-component/-/decode-uri-component-0.5.0.tgz
Upstream: https://github.com/SamVerschueren/decode-uri-component/tree/v0.5.0
MIT license retained in `license`.

The only source edit replaces `export default function decodeUriComponent` with
`module.exports = function decodeUriComponent`. The upstream decoding algorithm
is unchanged. This preserves query-string 7's callable CommonJS contract while
including the upstream malformed-percent decoding fix. Remove this adapter when
the pinned Expo Router dependency supports the patched ESM package directly.

Upstream index.js SHA-256: `9401353df38f8010ad7035fe8d666bce6a4902bc1cff809afc4ab23fa2e0bdaa`
