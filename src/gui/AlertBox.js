
import i18n from "i18next";


/** @constructor 
 *
 * @alias Autodesk.Viewing.Private.AlertBox
 *
 */
export function AlertBox() {
}

AlertBox.instances = [];

// static
// @param {string} [tag] - Optional, allows to dismiss the alert box afterwards
AlertBox.displayError = function(container, msg, title, imgClass, hints, tag ) {

    var _document = container.ownerDocument;
    var alertBox = _document.createElement("div");
    alertBox.className = "alert-box error";
    container.appendChild( alertBox );

    // Create the image element.
    var errorImageClass = imgClass;
    if (!errorImageClass)
        errorImageClass = "img-item-not-found";

    var alertBoxImg = _document.createElement("div");
    alertBoxImg.className = "alert-box-image " + errorImageClass;
    alertBox.appendChild( alertBoxImg );

    // Create the title & message element.
    var alertBoxMsg = _document.createElement("div");
    alertBoxMsg.className = "alert-box-msg";
    alertBox.appendChild( alertBoxMsg );

    var errorTitle = title;
    if (!errorTitle)
        errorTitle =  i18n.t( "Error Occurred", { "defaultValue" : "Error Occurred" } );

    var alertBoxTitle = _document.createElement("div");
    alertBoxTitle.className = "alert-box-title";
    alertBoxTitle.textContent = errorTitle;
    alertBoxTitle.setAttribute('data-i18n', errorTitle);
    alertBoxMsg.appendChild( alertBoxTitle );

    var alertBoxText = _document.createElement("div");
    alertBoxText.className = "alert-box-text";
    alertBoxText.textContent = msg;
    alertBoxText.setAttribute('data-i18n', msg);
    alertBoxMsg.appendChild( alertBoxText );

    // Add additional content
    if (hints) {
        var content = _document.createElement("div");
        content.className = "alert-box-content";
        alertBoxMsg.appendChild( content );

        var hintsElement = _document.createElement("ul");
        hintsElement.className = "alert-box-content";
        for (var h=0; h<hints.length; h++) {
            var hint = hints[h];
            if (!hint)
                continue;

            var hintElem = _document.createElement("li");

            var result = this.extractList(hint);
            if (result.list.length) {
                var unorderedlist = this.generateListElement(list, _document);
                hintsElement.appendChild( unorderedlist );
            }
            hintElem.innerHTML = result.msg;
            hintElem.setAttribute('data-i18n', result.msg);
            hintsElement.appendChild( hintElem );
        }
        content.appendChild( hintsElement );
    }

    var alertBoxOK = _document.createElement("div");
    alertBoxOK.className = "alert-box-ok";
    alertBoxOK.textContent = i18n.t( "OK", { "defaultValue" : "OK" } );

    var instance = { alertBox: alertBox, container: container, tag };
    alertBoxOK.addEventListener("click", function(event) {
        alertBox.style.visibility = "hidden";
        container.removeChild( alertBox );
        AlertBox.instances.splice(AlertBox.instances.indexOf(instance), 1);
    });
    alertBox.appendChild( alertBoxOK );

    alertBox.style.visibility = "visible";

    AlertBox.instances.push(instance);
};

// static
AlertBox.displayErrors = function(container, imgClass, errors) {

    var _document = container.ownerDocument;
    var alertBox = _document.createElement("div");
    alertBox.className = "alert-box errors";
    container.appendChild( alertBox );

    // Create the image element.
    var errorImageClass = imgClass;
    if (!errorImageClass)
        errorImageClass = "img-item-not-found";

    var alertBoxImg = _document.createElement("div");
    alertBoxImg.className = "alert-box-image " + errorImageClass;
    alertBox.appendChild( alertBoxImg );

    // Create the title & message element.
    var alertBoxMsg = _document.createElement("div");
    alertBoxMsg.className = "alert-box-msg errors";
    alertBox.appendChild( alertBoxMsg );

    for (var i=0; i<errors.length; i++) {

        var errorTitle = errors[i].header;
        if (!errorTitle)
            errorTitle =  i18n.t( "Error", { "defaultValue" : "Error" } );

        var alertBoxTitle = _document.createElement("div");
        alertBoxTitle.className = "alert-box-title errors";
        alertBoxTitle.textContent = errorTitle;
        alertBoxMsg.appendChild( alertBoxTitle );

        // Add message, there maybe a list of files at the end.
        var alertBoxText = _document.createElement("div");
        alertBoxText.className = "alert-box-text errors";

        var msg = errors[i].msg;
        var result = this.extractList(msg);
        if (result.list.length) {
            var listElem = _document.createElement("div");
            var unorderedlist = this.generateListElement(result.list, _document);
            listElem.appendChild( unorderedlist );

            alertBoxText.textContent = result.msg;
            alertBoxText.appendChild( listElem );
        } else {
            alertBoxText.textContent = msg;
        }
        alertBoxMsg.appendChild( alertBoxText );

        // Add additional content
        if (errors[i].hints) {
            var hintsElement = _document.createElement("ul");
            hintsElement.className = "alert-box-content";
            var hints = errors[i].hints;
            for (var h=0; h<hints.length; h++) {
                var hint = hints[h];
                if (!hint)
                    continue;

                var hintElem = _document.createElement("li");
                hintsElement.appendChild( hintElem );

                var result = this.extractList(hint);
                if (result.list.length) {
                    var unorderedlist = this.generateListElement(result.list, _document);
                    hintsElement.appendChild( unorderedlist );
                }
                hintElem.innerHTML = result.msg;
            }
            alertBoxMsg.appendChild( hintsElement );
        }
    }

    var alertBoxOK = _document.createElement("div");
    alertBoxOK.className = "alert-box-ok";
    alertBoxOK.textContent = i18n.t( "OK", { "defaultValue" : "OK" } );

    var instance = { alertBox: alertBox, container: container };
    alertBoxOK.addEventListener("click", function(event) {
        alertBox.style.visibility = "hidden";
        container.removeChild( alertBox );
        AlertBox.instances.splice(AlertBox.instances.indexOf(instance), 1);
    });
    alertBox.appendChild( alertBoxOK );

    alertBox.style.visibility = "visible";

    AlertBox.instances.push(instance);
};

AlertBox.extractList = function(msg) {
    var result = {
        "msg" : msg,
        "list" : []
    };

    if (msg && msg.indexOf("<ul>") != -1) {
        var parts = msg.split("<ul>");
        result.msg = parts[0];

        parts = parts[1].split("</ul>");
        result.list = parts[0].split(", ");
        if (result.list.length === 1) {
            // There maybe no spaces. Try just comma.
            result.list = parts[0].split(",");
        }
    }
    return result;
};


AlertBox.generateListElement = function(list, _document) {
    var unorderedlist = _document.createElement("ul");
    for (var l=0; l<list.length; l++) {
        var listElement = _document.createElement("li");
        listElement.textContent = list[l];
        listElement.setAttribute('data-i18n', list[l]);
        unorderedlist.appendChild( listElement );
    }

    return unorderedlist;
};

AlertBox.dismissByTag = function(tag) {

    // find instance matching the tag
    var index = AlertBox.instances.findIndex(inst => inst && inst.tag === tag);
    if (index == -1) {
        return false;
    }

    // dismiss box
    var instance = AlertBox.instances[index];
    instance.alertBox.style.visibility = "hidden";
    instance.container.removeChild( instance.alertBox );
    AlertBox.instances.splice(index, 1);
    return true;
};

// static
AlertBox.dismiss = function() {
    // dismiss the topmost alert box
    if (AlertBox.instances.length > 0) {
        var instance = AlertBox.instances.pop();
        instance.alertBox.style.visibility = "hidden";
        instance.container.removeChild(instance.alertBox);
        return true;
    }
    return false;
};


