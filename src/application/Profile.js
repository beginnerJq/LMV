import { Prefs3D, Prefs2D } from './PreferenceNames';
import { LocalStorage } from './LocalStorage';

/**
 * Profiles encapsulate viewer settings, extensions to unload, and extensions to load.
 * 
 * The `profileSettings.settings` parameter will override the existing  {@link Autodesk.Viewing.Private.Preferences|preferences} upon calling the {@link Autodesk.Viewing.Profile#apply|apply} method.
 * The `profileSettings.extensions.load` and `profileSettings.extensions.unload` arrays are used to load and unload extensions.
 * Make sure to set the profile by using the {@link Autodesk.Viewing.Viewer3D#setProfile} method.
 * 
 * @example
 * const profileSettings = {
 *    name: "mySettings",
 *    description: "My personal settings.",
 *    settings: {
 *        ambientShadows: false,
 *        groundShadows: true
 *    }
 *    persistent: ['ambientShadows'],
 *    extensions: {
 *        load: ["Autodesk.BimWalk"],   // Extensions to load
 *        unload: ["Autodesk.ViewCubeUi"]  // Extensions to unload and to not load
 *    }
 * };
 * const profile = new Autodesk.Viewing.Profile(profileSettings);
 * @constructor

 * @param {ProfileSettings} profileSettings - the profile settings. 
 * @alias Autodesk.Viewing.Profile
 */
export function Profile(profileSettings) {
    if (!profileSettings) return;
    const av = Autodesk.Viewing;
    const parentProfileSettings = av.ProfileSettings.Default;
    let prefsToOverride = [];

    // Use "Custom" as the profile name if a name is not passed in with the settings object
    this.name = Object.prototype.hasOwnProperty.call(profileSettings, 'name') ? profileSettings.name : 'Custom';
    this.label = profileSettings.label;
    this.description = profileSettings.description;

    // The format version of the data stored locally.
    this.storageVersion = '2.0';

    // Check which preferences we want to store.
    this.persistent = Array.isArray(profileSettings.persistent)
        ? profileSettings.persistent
        : parentProfileSettings.persistent;

    // Assign the default profile
    this.settings = Object.assign({}, parentProfileSettings.settings);

    if (Object.prototype.hasOwnProperty.call(profileSettings, 'settings')) {
        const settings = profileSettings.settings;
        prefsToOverride = Object.keys(settings);
        // merge the passed in profile with the default profile
        this.settings = Object.assign(this.settings, settings);
    }

    let extsToLoad = [];
    let extsToUnload = [];

    // Get the extensions that need to be loaded and unloaded
    if (Object.prototype.hasOwnProperty.call(profileSettings, 'extensions')) {
        const toLoad = profileSettings.extensions.load;
        const toUnload = profileSettings.extensions.unload;
        extsToLoad = toLoad ? toLoad.slice() : extsToLoad;
        extsToUnload = toUnload ? toUnload.slice() : extsToUnload;
    }

    this.extensions = {
        load: extsToLoad,
        unload: extsToUnload
    };

    /**
     * Applies the profile's settings to the viewer preferences.
     * To make the viewer react to the updated preferences please reference {@link Autodesk.Viewing.Viewer3D#setProfile}.
     * @param {Autodesk.Viewing.Private.Preferences} prefs - preferences instance.
     * @param {boolean} [override=true] - Override all existing preferences with the profile's preferences. 
     * @alias Autodesk.Viewing.Profile#apply
     */
    this.apply = function(prefs, override=true) {
        if (!prefs) {
            return false;
        }

        // If there are preferenes stored using the previous local store format, 
        // and they have the same name as the profile to be applied, those preferences
        // are moved to a JSON object under the profile name to apply.
        const currentStorageVerKey = prefs.getLocalStoragePrefix() + 'StorageVersion';
        const previousFormatProfileKey = 'Autodesk.Viewing.ProfileName';

        const needConversionFromVer1toVer2 = () => {
            if (!prefs.useLocalStorage) {
                return false;
            }
            return !LocalStorage.getItem(currentStorageVerKey) && 
                !!LocalStorage.getItem(previousFormatProfileKey);
        };

        const convertStorageFromVer1toVer2 = () => {
            const profile = {};
            const profileName = LocalStorage.getItem(previousFormatProfileKey);
            const prefix = prefs.getLocalStoragePrefix();
            for (let key of LocalStorage.getAllKeys()) {
                if (key.indexOf(prefix) !== -1) {
                    try {
                        profile[key.split('.').pop()] = JSON.parse(LocalStorage.getItem(key));
                        LocalStorage.removeItem(key);
                    }
                    catch {
                        console.log(`Cound't convert preference to new format: ${key}`);
                    }
                }
            }
            LocalStorage.setItem(prefix + profileName, JSON.stringify(profile));
            LocalStorage.removeItem(previousFormatProfileKey);
        };

        if (needConversionFromVer1toVer2()) {
            convertStorageFromVer1toVer2();
        }

        // Set the current storage format version.
        // If the format changes, knowing the format of saved data could be usefull
        // to convert the old data to the newer format.
        const currentSorageVerKey = prefs.getLocalStoragePrefix() + 'StorageVersion';
        LocalStorage.setItem(currentSorageVerKey, this.storageVersion);

        // Set the current profile in local storage.
        const currentProfileKey = prefs.getLocalStoragePrefix() + 'CurrentProfile';
        LocalStorage.setItem(currentProfileKey, this.name);

        prefs.setWebStorageKey(this.name);

        const settings = this.settings;
        const viewerDefined = [av.ProfileSettings.Default.name, av.ProfileSettings.AEC.name];
        const prefs3d = Object.values(Prefs3D);
        const prefs2d = Object.values(Prefs2D);
        for (let name in settings) {
            if (Object.prototype.hasOwnProperty.call(settings, name)) {
                const value = settings[name];
                // Ignore metadata if the profile is a custom one (not the ProfileSettings.AEC or the DefaultProfile Settings.)
                const tags =
                    prefsToOverride.indexOf(name) !== -1 && viewerDefined.indexOf(this.name) === -1
                        ? ['ignore-producer']
                        : [];
                if (prefs3d.indexOf(name) !== -1) {
                    tags.push('3d');
                } else if (prefs2d.indexOf(name) !== -1) {
                    tags.push('2d');
                } else {
                    tags.push('2d');
                    tags.push('3d');
                }

                // If the preference is not in the persistent array then add the no-storage tag.
                if (this.persistent.indexOf(name) === -1) {
                    tags.push('no-storage');
                }

                const storedValue = prefs.webStorage(name);
                const cachedValue = prefs.get(name);

                // If a value was stored, honor it no matter what.
                if (storedValue !== undefined) {
                    if (storedValue != cachedValue) {
                        prefs.add(name, storedValue, tags, true);
                        prefs.setDefault(name, value); // Configuring default value and tags for reset functionality.
                    }
                    continue;
                }

                if (cachedValue !== undefined) {
                    // Add tags to the preference even if the value did not change
                    prefs.addTags(name, tags);
                    // LMV-5591: override the set preferences with the profile's preferences.
                    // Fire an event if the preference value is being changed by the profile
                    if (cachedValue !== value && override) {
                        prefs.set(name, value);
                    }
                    continue;
                }

                // Add the preference and fire the event.
                prefs.add(name, value, tags, true);
            }
        }

        return true;
    };
}
