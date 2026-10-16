const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');
module.exports = function withFontScale(config) {
  return withAndroidManifest(config, result => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(result.modResults);
    const changes = new Set((activity.$['android:configChanges'] || '').split('|').filter(Boolean));
    // RN 0.86 handles font-scale layout updates in onConfigurationChanged.
    // Keep the ActivityResultRegistry alive for Expo file/camera pickers.
    changes.add('fontScale');
    activity.$['android:configChanges'] = [...changes].join('|');
    return result;
  });
};
