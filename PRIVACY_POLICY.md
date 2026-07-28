# Privacy Policy for Bug Lens

**Last Updated: July 28, 2026**

Bug Lens ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how our Chrome / Edge extension operates and handles user data.

## Data Collection & Storage
- **100% Local Processing**: Bug Lens collects diagnostic evidence (browser tab interaction logs, video recordings, console logs, and network requests) solely for issue reporting purposes.
- **No Off-Device Transmission**: All captured data remains strictly on your local machine. Bug Lens does not transmit, store, or upload any captured data to external servers or third parties.
- **Local Storage**: Recording configurations and temporary session data are saved locally via standard browser storage APIs (`chrome.storage`).

## Data Sharing
We do NOT sell, trade, rent, or share any user data with third parties.

## Permissions Usage
- `activeTab`: To inspect the current active tab and control recording sessions.
- `debugger`: To capture console and network diagnostic logs locally via Chrome DevTools Protocol.
- `downloads`: To allow downloading exported evidence packages to local disk.
- `offscreen`: To perform audio/video processing locally.
- `scripting`: To track click interactions on web pages during a recording session.
- `storage`: To save recording preferences locally.
- `tabCapture`: To record the active tab's screen during bug reproduction.
- `unlimitedStorage`: To hold temporary recording assets on local disk.
- `webNavigation`: To track navigation events so evidence capture continues across page loads.

## Contact Us
If you have any questions about this Privacy Policy, please reach out via GitHub Issues.
