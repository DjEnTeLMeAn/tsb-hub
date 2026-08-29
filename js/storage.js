(function initializeTSBStorage(global) {
  const STORAGE_KEY = 'tsb_hub_data_v1';
  const RECOVERY_BACKUP_KEY = `${STORAGE_KEY}_recovery`;
  const DEVICE_ID_KEY = 'tsb_hub_device_id';
  const OLD_TSB_KEY = 'tasks_v043';
  const OLD_HEALTH_KEY = 'healthData';
  const OLD_HEALTH_SETTINGS_KEY = 'healthSettings';

  const KEYS = Object.freeze({
    STORAGE_KEY,
    RECOVERY_BACKUP_KEY,
    DEVICE_ID_KEY,
    OLD_TSB_KEY,
    OLD_HEALTH_KEY,
    OLD_HEALTH_SETTINGS_KEY,
    data: STORAGE_KEY,
    recoveryBackup: RECOVERY_BACKUP_KEY,
    deviceId: DEVICE_ID_KEY,
    oldTasks: OLD_TSB_KEY,
    oldHealth: OLD_HEALTH_KEY,
    oldHealthSettings: OLD_HEALTH_SETTINGS_KEY
  });

  function get(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function set(key, value) {
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function remove(key) {
    try {
      global.localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  global.TSBStorage = Object.freeze({ KEYS, get, set, remove });
})(window);
