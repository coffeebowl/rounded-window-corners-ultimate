# `preferences`

This directory contains the code for the preferences page of the extension.

Note that the actual implementation of the preferences page is in the
`prefs.js` file, which uses files from this directory.

## `index.js`

Contains a `prefsTabs` variable that lists all of the tabs to be initialized.

## `corner_settings.js`

Connects the widgets for rounded corner settings to a settings object. Used
by the general page and the rows of the custom page.

## `pages`

This directory contains the code for each of the tabs, as well as the subpages
for editing the shadow and resetting the settings.

## `widgets`

This directory contains the code for the widgets used on the preferences page.
