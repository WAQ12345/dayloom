// Isolated acceptance build; never replaces the normal application.
module.exports = ({ config }) => process.env.DAYLOOM_ISOLATED_QA === '1'
  ? { ...config, name: 'Dayloom QA', scheme: 'dayloom-qa', android: { ...config.android, package: 'app.dayloom.mobile.qa' } }
  : config;
