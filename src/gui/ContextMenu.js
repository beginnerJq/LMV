
import { isTouchDevice } from "../compat";
import { logger } from "../logger/Logger";
import i18n from "i18next";
import { GlobalManagerMixin } from '../application/GlobalManagerMixin';
import { EventUtils } from "../application/EventUtils";


/** @constructor */
export function ContextMenu(viewer, options = {}) {
    this.viewer = viewer;
    this.setGlobalManager(viewer.globalManager);
    this.menus = [];
    this.container = null;
    this.open = false;
    this._onDOMevent = this._onDOMevent.bind(this);
    this.onHide = options.onHide;
}

ContextMenu.prototype.constructor = ContextMenu;
GlobalManagerMixin.call(ContextMenu.prototype);

ContextMenu.prototype.show = function(event, menu) {
    var viewport = this.viewer.container.getBoundingClientRect();

    // Normalize Hammer events
    if (Array.isArray(event.changedPointers) && event.changedPointers.length > 0) {
        event.clientX = event.changedPointers[0].clientX;
        event.clientY = event.changedPointers[0].clientY;
    }

    var x = event.clientX - viewport.left;
    var y = event.clientY - viewport.top;

    if (!this.open) {
        this.showMenu(menu, x, y);
        this.open = true;
    }

    // Remember mouse coords.
    this._startX = event.clientX;
    this._startY = event.clientY;
};

ContextMenu.prototype.showMenu = function (menu, x, y, shiftLeft) {

    var menuItem;
    var submenus = [];

    var _document = this.getDocument();
    // Create a menu container of the size of the viewer to eat the next click event
    // to close the menu.
    var container = _document.createElement('div');
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.position = 'absolute';
    container.style.zIndex = '10';

    var menuDiv = _document.createElement('div');
    menuDiv.classList.add('menu');
    menuDiv.classList.add('docking-panel');
    menuDiv.classList.add('docking-panel-container-solid-color-a');
    container.appendChild(menuDiv);

    this.viewer.container.appendChild(container);
    this.container = container;

    this.menus.push(menuDiv);

    let addExpandDiv = false;

    for (var i = 0; i < menu.length; ++i) {
        var defn = menu[i],
            title = defn.title,
            target = defn.target,
            icon = defn.icon,
            shortcut = defn.shortcut,
            divider = defn.divider;

        let hasChildren = Array.isArray(target);

        if (hasChildren && !menu.isChild) {
            addExpandDiv = true; // Keep track of any item that is expandable
        } else {
            // As described in the design, limit the the number of menu levels to two.
            // We will flatten the target array
            hasChildren = false;
        }

        if (divider) {
            menuItem = this.createDivider();
            menuDiv.appendChild(menuItem);
        } else {
            menuItem = this.createMenuItem(title, icon, shortcut, hasChildren);
            menuDiv.appendChild(menuItem);

            if (typeof target === 'function') {
                this.addCallbackToMenuItem(menuItem, target);
            } else if (hasChildren) {
                submenus.push({menuItem: menuItem, target: target});
            } else {
                logger.warn("Invalid context menu option:", title, target);
            }
        }
    }

    // If there weren't any context menu's with expandable submenus, remove the expand div.
    if (!addExpandDiv) {
        const children = menuDiv.children;
        for (let i = 0; i < children.length; i++) {
            const item = children[i];
            const expandDivs = item.getElementsByClassName('menu-item-expand');
            if (expandDivs.length > 0) {
                item.removeChild(expandDivs[0]);
            }
        }
    }

    var rect = menuDiv.getBoundingClientRect(),
        menuDivWidth = rect.width,
        menuDivHeight = rect.height,
        viewerRect = this.viewer.container.getBoundingClientRect(),
        viewerWidth = viewerRect.width,
        viewerHeight = viewerRect.height;
        
    shiftLeft = !!shiftLeft || (isTouchDevice() && !this.viewer.navigation.getUseLeftHandedInput());

    if (shiftLeft) {
        x -= menuDivWidth;
    }

    if (x < 0) {
        x = 0;
    }
    if (viewerWidth < x + menuDivWidth) {
        x = viewerWidth - menuDivWidth;
        if (x < 0) {
            x = 0;
        }
    }

    if (y < 0) {
        y = 0;
    }
    if (viewerHeight < y + menuDivHeight) {
        y = viewerHeight - menuDivHeight;
        if (y < 0) {
            y = 0;
        }
    }

    menuDiv.style.top = Math.round(y) + "px";
    menuDiv.style.left = Math.round(x) + "px";

    const reorderMenuItems = (menuItem, showExpand) => {
        const expanded = menuItem.getElementsByClassName('menu-item-expand');

        // Remove the expand arrow
        menuItem.removeChild(expanded[0]);

        const icons = menuItem.getElementsByClassName('menu-item-icon');
        // Reorder the icon
        icons.length > 0 && menuItem.insertBefore(icons[0], menuItem.childNodes[menuItem.length - 1]);

        // Append the expand arrow to the left.
        this.setMenuExpand(menuItem, true, showExpand);
    };

    let moveLeft = false;
    for (i = 0; i < submenus.length; ++i) {
        var submenu = submenus[i];

        menuItem = submenu.menuItem;
        const rect = menuItem.getBoundingClientRect();
        const viewerRect = this.viewer.container.getBoundingClientRect();

        const tolerance = rect.right - rect.left;
        moveLeft = viewerRect.right - rect.right < tolerance || shiftLeft;

        if (moveLeft) {
            reorderMenuItems(menuItem, true);
        }

        x = Math.round((moveLeft ? rect.left : rect.right) - viewerRect.left);
        y = Math.round(rect.top - viewerRect.top);

        this.addSubmenuCallbackToMenuItem(menuItem, submenu.target, x, y, moveLeft);
    }

    // Move the expand div to the front. 
    // This will remove the extra padding from the right side of the the context menu
    if (submenus.length > 0 && moveLeft) {
        const children = menuDiv.children;
        for (let i = 0; i < children.length; i++) {
            const item = children[i];
            if (item.children.length > 2 && item.children[2].className.indexOf('menu-item-expand') !== -1) {
                reorderMenuItems(item, false);
            }
        }
    }

    this.container.addEventListener('touchend', this._onDOMevent);
    this.container.addEventListener('mousedown', this._onDOMevent);
    this.container.addEventListener('mouseup', this._onDOMevent);
    if (!isTouchDevice()) {
        this.container.addEventListener('mousemove', this._onDOMevent);
    }
};


/**
 * @private
 */ 
ContextMenu.prototype._onDOMevent = function(event) {
    var eventType = event.type;
    switch (eventType) {

        case 'touchend':
            if (!this._isContextMenu(event)) {
                this.hide();
            }
            break;

        case 'mousedown':
            this._startX = event.clientX;
            this._startY = event.clientY;
            break;

        case 'mouseup':
            if (!this._isContextMenu(event)) {
                this.hide();
                if (EventUtils.isRightClick(event) && 
                    event.clientX === this._startX && 
                    event.clientY === this._startY) 
                {
                    this.viewer.triggerContextMenu(event);
                }
            }
            break;
        case 'mousemove': {
            // Used when hovering over menu item with submenu.
            if (!this.currentItem || this.menus.length < 2) {
                break;
            }

            const isInsideMenuItem = this._isInside(event, this.currentItem );
            const isInsideSubmenu = this._isInside(event, this.menus[1]);

            // Hide menu if mouse is not on submenu or on the menu item
            if (!isInsideMenuItem && !isInsideSubmenu) {
                // Hide the extra menu
                this.hideMenu(this.menus[1]);
                this.currentItem.style.backgroundColor = null;
                this.currentItem = null;
            } else if (this.currentItem.backgroundColor) {
                // Highlight the menu item ff the cursor is inside of the menu item or the submenu.
                this.currentItem.style.backgroundColor = this.currentItem.backgroundColor;
            }
            break;
        }
    }
    
};


/**
 * @param text - the menu item description
 * @param icon (optional) - className: a CSS class with a content field referencing an icon
 * @param shortcut (optional) - the menu item keyboard shortcut
 * @param {boolean} [expand=false] - if set to true add arrow to expand
 * @returns menuItem - div element containing the menu item elements
 */
ContextMenu.prototype.createMenuItem = function(text, icon, shortcut, expand=false) {
    var _document = this.getDocument();    
    var menuItem = _document.createElement("div");
    menuItem.className = "menu-item";
    shortcut = shortcut || '';

    this.setMenuItemIcon(menuItem, icon);
    this.setMenuItemText(menuItem, text);
    this.setMenuExpand(menuItem, false, expand);
    this.setMenuItemShortcut(menuItem, shortcut);
    return menuItem;
};

/**
 * 
 * @returns container - The divider item that was created
 */
ContextMenu.prototype.createDivider = function() {
    var _document = this.getDocument();
    var container = _document.createElement("div");            
    container.className = 'menu-divider-container';

    var divider = _document.createElement("div");
    divider.className = 'menu-divider';
    container.appendChild(divider);
    return container;
};

ContextMenu.prototype.setMenuItemIcon = function(menuItem, iconClass) {
    var _document = this.getDocument();
    var menuItemIcon = _document.createElement("div");
    menuItemIcon.classList.add("menu-item-icon");

    if (iconClass) {
        menuItemIcon.classList.add(iconClass);
    }

    menuItem.appendChild(menuItemIcon);
};

ContextMenu.prototype.setMenuItemText = function(menuItem, text) {
    var _document = this.getDocument();
    var menuItemText = _document.createElement("div");
    menuItemText.classList.add("menu-item-text");
    menuItemText.setAttribute("data-i18n", text);
    menuItemText.textContent = i18n.t( text );
    menuItem.appendChild(menuItemText);
};

ContextMenu.prototype.setMenuItemShortcut = function(menuItem, shortcut) {
    var _document = this.getDocument();
    var menuItemShortcut = _document.createElement("div");
    menuItemShortcut.classList.add("menu-item-shortcut");
    menuItemShortcut.textContent = shortcut;
    menuItem.appendChild(menuItemShortcut);
};

ContextMenu.prototype.setMenuExpand = function (menuItem, shiftLeft, show) {
    var _document = this.getDocument();
    var menuItemExpand = _document.createElement('div');
    menuItemExpand.classList.add('menu-item-expand');
    if (shiftLeft) {
        // Rotate the arrow image and insert it as the first element
        menuItemExpand.style.transform = 'scale(-1)';
        menuItem.insertBefore(menuItemExpand, menuItem.childNodes[0]);
    } else {
        menuItem.appendChild(menuItemExpand);
    }
    const opacity = show | 0;
    menuItemExpand.style.opacity = opacity;
};

ContextMenu.prototype.addCallbackToMenuItem = function (menuItem, target) {
    var that = this;

    menuItem.addEventListener('click', function (event) {
        that.hide();
        target();
        event.preventDefault();
        return false;
    }, false);
};

ContextMenu.prototype.addSubmenuCallbackToMenuItem = function (menuItem, menu, x, y, shiftLeft) {
    var that = this;
    menu.isChild = true;
    if (isTouchDevice()) {
        menuItem.addEventListener(
            'click',
            function () {
                that.open = true;
                that.currentItem = menuItem;
                that.showMenu(menu, x, y, shiftLeft);
            },
            false
        );
    } else {
        // Used when hovering over the context menu item.
        menuItem.addEventListener(
            'mouseenter',
            function () {
                const isInside = that._isInside(event, menuItem);
                if (isInside) {
                    that.open = true;
                    that.currentItem = menuItem;

                    // Keep track of the background color when hovering over the submenu item.
                    const _window = that.getWindow();
                    const backgroundColor = _window
                        .getComputedStyle(that.currentItem)
                        .getPropertyValue('background-color');
                    that.currentItem.backgroundColor = backgroundColor;
                    that.showMenu(menu, x, y, shiftLeft);
                }
            },
            false
        );
    }
};

ContextMenu.prototype.hideMenu = function (menu) {
    const hideContainer = (container) => {
        container.removeEventListener('touchend', this._onDOMevent);
        container.removeEventListener('mousedown', this._onDOMevent);
        container.removeEventListener('mouseup', this._onDOMevent);
        if (!isTouchDevice()) {
            container.removeEventListener('mousemove', this._onDOMevent);
        }
        container.parentNode.removeChild(container);
    };

    if (menu && this.menus.indexOf(menu) !== -1 && menu.parentNode) {
        hideContainer(menu.parentNode);
        this.menus.splice(this.menus.indexOf(menu), 1);
    }

    if (this.menus.length === 0) {
        this.open = false;
        this.container = null;
    } else if (this.menus.length === 1) {
        this.container = this.menus[0].parentNode;
    }
};

ContextMenu.prototype.hide = function() {
    if (this.open) {
        while (this.menus.length > 0) {
            this.hideMenu(this.menus[0]);
        }
        
        if (this.onHide) {
            this.onHide();
        }

        return true;
    }
    return false;
};


/**
 * Returns true when the event occurs on top of the context menu.
 * @private
 */
ContextMenu.prototype._isContextMenu = function(event) {
    // Iterate over all of the menus
    for (let i = 0; i < this.menus.length; i++) {
        const menuDiv = this.menus[i];
        var curr = event.target;

        while (curr !== this.container) {
            if (curr === menuDiv) return true;
            curr = curr.parentNode;
        }
    }
    return false;
};

/**
 * Returns true if the event's mouse position intersects the item's bounding box.
 * @param {Event} event 
 * @param {HTMLElement} item 
 * @private
 */
ContextMenu.prototype._isInside = function (event, item) {
    var viewport = this.viewer.container.getBoundingClientRect();

    // Normalize Hammer events
    if (Array.isArray(event.changedPointers) && event.changedPointers.length > 0) {
        event.clientX = event.changedPointers[0].clientX;
        event.clientY = event.changedPointers[0].clientY;
    }

    var x = Math.ceil(event.clientX - viewport.left);
    var y = Math.ceil(event.clientY - viewport.top);

    const itemBB = item.getBoundingClientRect();

    const top = Math.floor(itemBB.top - viewport.top);
    const bottom = Math.ceil(itemBB.bottom - viewport.top);
    const left = Math.floor(itemBB.left - viewport.left);
    const right = Math.ceil(itemBB.right - viewport.left);

    return y >= top && y <= bottom && x >= left && x <= right;
};