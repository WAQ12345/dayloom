const { withAppBuildGradle } = require('@expo/config-plugins');
module.exports = function withLocalSigning(config) {
  return withAppBuildGradle(config, result => {
    let source = result.modResults.contents;
    if (source.includes('// daily-life-local-signing')) return result;
    if (!source.includes('signingConfigs {')) throw new Error('Signing template changed; inspect generated Gradle before release.');
    source = source.replace('signingConfigs {', `signingConfigs {
        // daily-life-local-signing
        dailyLifeRelease {
            if (System.getenv('DAILY_SIGNING_STORE')) {
                storeFile file(System.getenv('DAILY_SIGNING_STORE'))
                storePassword System.getenv('DAILY_SIGNING_PASSWORD')
                keyAlias System.getenv('DAILY_SIGNING_ALIAS')
                keyPassword System.getenv('DAILY_SIGNING_PASSWORD')
            }
        }`);
    const release = /release\s*\{([\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!release.test(source)) throw new Error('Release signing block changed; refusing to use the template debug key.');
    source = source.replace(release, 'release {$1signingConfig signingConfigs.dailyLifeRelease');
    result.modResults.contents = source;
    return result;
  });
};
