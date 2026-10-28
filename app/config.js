// ===== すっきり容量整理 の設定 =====
// 配る人（設定する人）が一度だけ書き込みます。手順は README.md の「設定のしかた」をご覧ください。
// 使わないクラウドは空欄 '' のままにすると、画面に表示されません。
window.APP_CONFIG = {
  // Google Cloud で作った「OAuth クライアント ID」（ウェブ アプリケーション）
  // 例: '123456789012-abcdefg.apps.googleusercontent.com'
  googleClientId: '644287317035-fm6933omr001c95ulnrf9n4d08tdq78l.apps.googleusercontent.com',

  // Microsoft Entra（Azure）で登録したアプリの「アプリケーション (クライアント) ID」
  // 例: '11111111-2222-3333-4444-555555555555'
  microsoftClientId: '',

  // 個人の Microsoft アカウントだけなら 'consumers'、会社・学校のアカウントも使うなら 'common'
  microsoftTenant: 'consumers',
};
