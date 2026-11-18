# LORE on iPhone and the App Store

## Right now, with no store at all

LORE already works on any phone or computer in the browser: **https://lore-g8co.onrender.com**.
Same account, same data, same Oracle.

On an iPhone, make it an app icon: open the link in **Safari** → **Share** button → **Add to Home
Screen**. It opens full screen like an app. (Until the App Store version exists, reminders on iPhone
show inside LORE but don't pop up when it's closed.)

## What's ready in the code

- `apps/ios`: the iPhone app, built from the same code as the website and the Android app (Capacitor),
  with the LORE icon and splash screen.
- Live updates: like on Android, every change we push reaches installed iPhones without a new App Store
  release (only native changes need one).
- `.github/workflows/ios.yml`: builds the app on a Mac in GitHub's cloud and uploads it to TestFlight.
  Nobody needs to own a Mac. **Not run yet**: it needs the Apple account below.

## What only you can do

1. **Join the Apple Developer Program**: https://developer.apple.com/programs/enroll/
   - Enroll as an **individual** with your Apple ID (two-factor sign-in must be on).
   - 99 USD a year (or the local price), paid by card. Approval usually takes a day or two.
2. **To sell it**: App Store Connect → **Business** → accept the *Paid Apps* agreement, add a bank account
   and fill in the tax forms. Also apply for the **App Store Small Business Program**: Apple then keeps 15%
   instead of 30% (for under 1 million USD a year).
3. **An iPhone for testing** (strongly recommended): TestFlight builds install on it before anyone else
   sees the app.

## Steps, once the account is approved

1. **Bundle ID**: https://developer.apple.com/account/resources/identifiers → **+** → *App IDs* → *App* →
   Bundle ID **explicit**: `com.gosinn.lore`, description "LORE". No extra capabilities needed.
2. **The app record**: https://appstoreconnect.apple.com → *Apps* → **+** → *New App* → iOS, name **LORE**
   (if it's taken: "LORE: Life Of Regular Epics"), bundle ID `com.gosinn.lore`, SKU `lore-ios`.
3. **A key for the cloud build**: App Store Connect → *Users and Access* → *Integrations* → *App Store
   Connect API* → *Team Keys* → **+**, role **Admin**. Download the `.p8` file (only possible once; keep
   it somewhere safe, outside the repo) and note the **Key ID** and the **Issuer ID**.
4. **Give the key to GitHub** (never paste it into a chat): github.com/Gosinn/LORE → *Settings* →
   *Secrets and variables* → *Actions* → *New repository secret*, four times:

   | Name | Value |
   |---|---|
   | `APPLE_TEAM_ID` | the 10-character Team ID (developer.apple.com → *Membership*) |
   | `ASC_KEY_ID` | the Key ID |
   | `ASC_ISSUER_ID` | the Issuer ID |
   | `ASC_KEY_P8` | open the `.p8` file in Notepad and paste all of it |

5. **Build**: GitHub → *Actions* → **iOS build** → *Run workflow*. Takes about 15–25 minutes. The build
   then shows up in App Store Connect → *TestFlight* (after Apple's processing, ~10 more minutes).
6. **Try it**: install the **TestFlight** app on the iPhone, accept the invite, open LORE.
7. **Submit**: screenshots, description, price, privacy answers, a demo account for the reviewer, then
   *Submit for Review*. First reviews take a day or a few.

## What Apple requires before it says yes

Apps where people post things for each other (App Review Guideline 1.2) and apps with accounts (5.1.1)
have extra rules.

| Requirement | Status |
|---|---|
| Delete your account inside the app | ✅ built |
| Block people | ✅ built |
| **Report** posts, comments and people; someone acts on reports within 24 hours | ⬜ to build |
| **Terms** that say abusive content isn't tolerated | ⬜ to write |
| **Privacy policy** page (a public URL) | ⬜ to write (needs a contact address) |
| **Support** page or contact | ⬜ |
| App Privacy answers (what data LORE collects and why) | ⬜ I'll prepare them |
| A demo account for the reviewer | ⬜ at submission time |
| More than a website in a wrapper (4.2) | 🟡 notifications, live updates, the Oracle; Apple decides |
| Sign in with Apple | Not required: LORE has no Google/Facebook sign-in |

## Costs

- Apple: 99 USD a year, plus 15% (Small Business Program) of what users pay.
- GitHub's Macs: a private repository gets 2,000 free minutes a month, and Mac minutes count ten times,
  so roughly 10 iPhone builds a month for free. Public repositories build for free.
- Server: still the free Render + Neon setup. Paying users will deserve a paid server (about 7 USD a month
  on Render plus Neon's free or 19 USD tier) so LORE doesn't nap when idle.
