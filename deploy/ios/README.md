# LORE on iPhone and the App Store

## Right now, with no store at all

LORE already works on any phone or computer in the browser: **https://lore-g8co.onrender.com**.
Same account, same data, same Loracle.

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
| **Report** people, plans, ideas, chapters, stories and messages (with block in the same step) | ✅ built |
| Someone acts on reports within 24 hours | ✅ Moderation screen; **you** (`gosinn`) are the moderator by default (below) |
| **Terms** that say abusive content isn't tolerated; agreed to at sign-up | ✅ https://lore-g8co.onrender.com/terms |
| **Privacy policy** page | ✅ https://lore-g8co.onrender.com/privacy |
| **Support** page with a contact form | ✅ https://lore-g8co.onrender.com/support |
| App Privacy answers | ✅ below |
| Forgot-password by email | ⬜ needs an email service; until then people write via the support page |
| A demo account for the reviewer | ⬜ at submission time |
| More than a website in a wrapper (4.2) | 🟡 notifications, live updates, The Loracle; Apple decides |
| Explicit permission before personal data goes to a third-party AI (5.1.2(i)) | ✅ The Loracle shows a consent sheet before the first wish is sent to Claude (Anthropic); "Stop sending wishes" withdraws it |
| Sign in with Apple | Not required: LORE has no Google/Facebook sign-in |

## Become the moderator

You already are: your account `gosinn` (created before 19 November 2026) is the owner by default, so
Profile shows **Moderation** (and **Edit text**, for changing LORE's words live), and Home tells you when
there's a report or a message waiting. Apple expects reports to be handled within 24 hours.

To choose someone else (or several people): Render → your LORE service → **Environment** → **Add
Environment Variable**: key `ADMIN_USERNAMES`, value = the LORE usernames, separated with commas →
**Save**. Once that variable is set, exactly those people are moderators (an empty value means nobody).

## App Privacy answers (App Store Connect → App Privacy)

- Tracking: **No**, LORE doesn't track people across apps or websites. Sending wishes to Anthropic as
  a service provider (the mind behind The Loracle) is not tracking.
- Data collected, all *linked to the user*, all used only for *App Functionality*:
  - Contact Info: **Name**, **Email Address**
  - User Content: **Photos or Videos**, **Other User Content** (plans, stories, comments, notes, and
    The Loracle's wishes, quests and waypoint notes)
  - Health & Fitness: **Health** (The Loracle's optional "Your body" answer invites health details,
    like "a bad left knee")
  - Other Data: **Other Data Types** (The Loracle's optional age band, money and time answers, and
    passport country)
  - Location: **Coarse Location** (where you stand in The Loracle and Home's daily sign: a town people
    type, or the device's location rounded to two decimals, about a kilometre, on the device before it is
    sent; Info.plist asks for reduced accuracy by default. Its town and country also go to Anthropic with
    a wish)
  - Identifiers: **User ID**
- Not collected: payment info (Apple handles it), contacts, browsing history, precise location,
  diagnostics, advertising data.
- **The Lore Map** (D35) changes no answer above, as far as we can tell (owner to confirm at submission):
  - The places people give chapters, plans and ideas are **Other User Content**: a town or spot picked from a
    search, never the device's position. The map never reads the device's location, so precise location
    stays "not collected".
  - The map's tiles come from **OpenFreeMap** (`tiles.openfreemap.org`), loaded by the device directly: like
    any website, it sees the device's IP address and which part of the world is on screen, but none of the
    person's places, plans or account. OpenFreeMap needs no key and sets no cookies (its site, read
    2026-11-19); this is not tracking. The Privacy policy says so under "Who helps us run LORE".
  - MapLibre runs its worker from a `blob:` URL. **Not verified in the iOS web view yet**; if it fails there,
    the list of places under the map still works.
- **App Review notes** (paste at submission): "The Loracle sends a wish to Claude (Anthropic) only
  after the consent sheet. The demo account has not consented, so the reviewer sees the sheet." Keep the
  demo account un-consented. If the server has no ANTHROPIC_API_KEY, The Loracle shows the stone asleep
  and nothing is sent.

## Selling it

- Price: set in App Store Connect → *Pricing and Availability* (for example the 2.99 USD tier).
- In the EU, anyone *selling* an app is a trader: Apple shows a contact **address, phone number and
  email** on LORE's EU App Store page (Digital Services Act). Use details you're happy to make public, or
  leave the EU out of the countries list at first.
- The website stays free and works on any phone. Decide later whether it should ask for the App Store
  version, a web payment, or stay as the free door into LORE.

## Costs

- Apple: 99 USD a year, plus 15% (Small Business Program) of what users pay.
- GitHub's Macs: a private repository gets 2,000 free minutes a month, and Mac minutes count ten times,
  so roughly 10 iPhone builds a month for free. Public repositories build for free.
- Server: still the free Render + Neon setup. Paying users will deserve a paid server (about 7 USD a month
  on Render plus Neon's free or 19 USD tier) so LORE doesn't nap when idle.
