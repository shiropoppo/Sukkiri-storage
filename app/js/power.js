// 長い作業のあいだの「電源まわり」の見守り
//   ・画面が消えないようにする（スマホは画面が消えると作業が止まるため）
//   ・Windows ではパソコンがスリープしないようにする（裏方に頼む）
//   ・電池の残りを見て、少なくなったら知らせ、なくなりそうなら安全なところで止める

export async function getBattery() {
  try {
    return navigator.getBattery ? await navigator.getBattery() : null;
  } catch {
    return null;
  }
}

export const LOW_LEVEL = 0.15;      // これより少ないと「充電してください」と表示
export const CRITICAL_LEVEL = 0.06; // これより少ないと、今のファイルが終わったところで止める

export class PowerGuard {
  constructor({ server, onLow, onCritical } = {}) {
    this.server = server;
    this.onLow = onLow;
    this.onCritical = onCritical;
    this.lock = null;
    this.active = false;
    this.critical = false;
    this.onVisible = () => {
      if (this.active && document.visibilityState === 'visible') this.acquire();
    };
    this.onBatteryChange = () => this.checkBattery();
  }

  async start() {
    this.active = true;
    await this.acquire();
    document.addEventListener('visibilitychange', this.onVisible);
    this.server?.keepAwake(true).catch(() => {});
    this.battery = await getBattery();
    if (this.battery) {
      this.battery.addEventListener('levelchange', this.onBatteryChange);
      this.battery.addEventListener('chargingchange', this.onBatteryChange);
      this.checkBattery();
    }
  }

  async acquire() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !this.lock) {
        this.lock = await navigator.wakeLock.request('screen');
        this.lock.addEventListener('release', () => { this.lock = null; });
      }
    } catch { /* 使えない端末では、画面の案内だけで対応する */ }
  }

  checkBattery() {
    const b = this.battery;
    if (!b || !this.active) return;
    const low = !b.charging && b.level <= LOW_LEVEL;
    this.onLow?.(low, b);
    if (!b.charging && b.level <= CRITICAL_LEVEL && !this.critical) {
      this.critical = true;
      this.onCritical?.();
    }
  }

  stop() {
    this.active = false;
    document.removeEventListener('visibilitychange', this.onVisible);
    this.lock?.release().catch(() => {});
    this.lock = null;
    this.server?.keepAwake(false).catch(() => {});
    if (this.battery) {
      this.battery.removeEventListener('levelchange', this.onBatteryChange);
      this.battery.removeEventListener('chargingchange', this.onBatteryChange);
    }
    this.onLow?.(false, null);
  }
}
