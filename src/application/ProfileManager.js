import { logger } from '../logger/Logger';
import { Profile } from './Profile';

/**
 * The ProfileManager provides a mechanism for registering {@link ProfileSettings|profile settings} with a specific file type.
 * Any of the registered profiles can be set by using {@link Autodesk.Viewing.Viewer3D#setProfile|viewer.setProfile()}.
 * 
 * @example
 *   const profileManager = new Autodesk.Viewing.ProfileManager();
 *   // or
 *   // const profileManger = viewer.profileManager;
 *   const profileSettings = {
 *      name: "DWF",
 *      settings: {
 *          swapBlackAndWhite: true
 *      },
 *      // ...
 *   }
 *   // Registers the specified profile settings for dwf models.
 *   profileManager.registerProfile('dwf', profileSettings);
 *   const profile = profileManager.getProfile('dwf'); // others: 'default', 'nwc', 'nwd', 'rvt', 'ifc'
 *   viewer.setProfile(profile);
 * @constructor
 * 
 * @alias Autodesk.Viewing.ProfileManager
 */
export class ProfileManager {
    constructor() {
        this.registered = {};
        // Register known profileSettings.
        const knownProfileSettings = Autodesk.Viewing.ProfileSettings;
        
        // The default profile will be used for everything else.
        this.PROFILE_DEFAULT =  new Profile(knownProfileSettings.Default);
        this.registerProfile('default', this.PROFILE_DEFAULT);

        // The AEC profile will be used for rvt and ifc file types.
        this.PROFILE_AEC = new Profile(knownProfileSettings.AEC);
        this.registerProfile('rvt', this.PROFILE_AEC);
        this.registerProfile('ifc', this.PROFILE_AEC);

        // The Navis profile will be used for nwc and nwd file types.
        this.PROFILE_NAVIS = new Profile(knownProfileSettings.Navis);
        this.registerProfile('nwc', this.PROFILE_NAVIS);
        this.registerProfile('nwd', this.PROFILE_NAVIS);

        // Design Collaboration profile. The extension doesn't matter here.
        this.PROFILE_FLUENT = new Profile(knownProfileSettings.Fluent);
        this.registerProfile('fluent', this.PROFILE_FLUENT);
    }

    /**
     * Registers a profile. The profile will be overridden if a profile was already registered with the ProfileManager.
     * @param {String} fileExt - file extension to register the profile settings with.
     * @param {ProfileSettings|Autodesk.Viewing.Profile} profileSettings - profile settings object or profile instance to register
     * @alias Autodesk.Viewing.ProfileManager#registerProfile
     */
    registerProfile(fileExt, profileSettings) {
        if (!profileSettings) {
            logger.log('ProfileManager: missing profileSettings when registering a profile.');
            return;
        }
        fileExt = fileExt || 'default';
        this.registered[fileExt] = profileSettings instanceof Profile ? profileSettings : new Profile(profileSettings);
    }

    /**
     * Unregister the profile associated with a file type
     * @param {String} fileExt - file type
     * @alias Autodesk.Viewing.ProfileManager#unregisterProfile
     */
    unregisterProfile(fileExt) {
        if (!fileExt) {
            logger.log('ProfileManager: missing fileExt when unregistering a profile.');
            return;
        }
        delete this.registered[fileExt];
    }

    /**
     * Returns the registered profiles object.
     * @returns {Object} - registered profiles to specific fily types
     */
    getProfiles() {
        return Object.assign({}, this.registered);
    }

    /**
     * Returns a profile that is registered with the specific file type. If the file type is not registered, then the default profile is returned.
     * @param {String} fileExt - file extension
     * @returns {Autodesk.Viewing.Profile} - Profile associated with the file extension.
     * @alias Autodesk.Viewing.ProfileManager#getProfileOrDefault
     */
    getProfileOrDefault(fileExt) {
        if (!fileExt) {
            logger.log('ProfileManager: missing fileExt for getProfile. Returning the default Profile.');
            return this.registered.default;
        }

        const registeredProfile = this.registered[fileExt];

        if (!registeredProfile) {
            logger.log(`ProfileManager: No profile registered for ${fileExt}. Returning the default Profile.`);
            return this.registered.default;
        } else {
            return registeredProfile;
        }
    }
}
