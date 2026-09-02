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

  function isDataPayload(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
      const parsed = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch (error) {
      return false;
    }
  }

  function get(key) {
    try {
      const value = global.localStorage.getItem(key);
      if (key !== STORAGE_KEY || isDataPayload(value)) return value;

      const recovery = global.localStorage.getItem(RECOVERY_BACKUP_KEY);
      return isDataPayload(recovery) ? recovery : value;
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

  function clearAllData({ preserveDeviceId = false } = {}) {
    const keys = [
      STORAGE_KEY,
      RECOVERY_BACKUP_KEY,
      OLD_TSB_KEY,
      OLD_HEALTH_KEY,
      OLD_HEALTH_SETTINGS_KEY
    ];
    if (!preserveDeviceId) keys.push(DEVICE_ID_KEY);

    const failedKeys = [];
    for (const key of keys) {
      if (!remove(key)) {
        failedKeys.push(key);
        continue;
      }

      // Treat a storage implementation that silently keeps the value as a
      // failure too; callers must be able to detect a partial reset.
      try {
        if (global.localStorage.getItem(key) !== null) failedKeys.push(key);
      } catch (error) {
        failedKeys.push(key);
      }
    }

    return {
      ok: failedKeys.length === 0,
      failedKeys
    };
  }

  global.TSBStorage = Object.freeze({ KEYS, get, set, remove, clearAllData });
})(window);
