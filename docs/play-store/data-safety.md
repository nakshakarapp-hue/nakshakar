# Data safety form answers

These match what the app does; see `site/privacy.html`.

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | Not applicable: no user data is collected. (The only request, for the public version file, uses HTTPS.) |
| Do you provide a way for users to request that their data is deleted? | Not applicable: nothing is stored off the device. Uninstalling removes everything. |

Why "No" is correct:

- Projects, prices and settings are stored only on the device.
- The app makes one network request, to read the public `version.json` file on the website. It sends no
  identifiers, no device information and no project data.
- There are no analytics, advertising or crash-reporting libraries.
- Sharing a house hands a file to the phone's own share sheet at the user's request. Google treats data
  the user chooses to send through another app as not shared by your app.
