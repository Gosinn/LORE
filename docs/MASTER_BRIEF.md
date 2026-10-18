# LORE — Master Product Blueprint

**NO SCROLLING. ONLY ROLLING.**
*Make life worth remembering.*

| | |
|---|---|
| Product | LORE |
| Category | Social experiences, collaborative memory, event coordination, and personal history |
| Status | Concept and development specification |
| Version | 0.1 |
| Date | October 18, 2026 |

> This is the product owner's specification, kept verbatim in content. Implementation decisions live in
> `ARCHITECTURE.md` and `DECISIONS.md`; build progress lives in `ROADMAP.md` and `DEVELOPMENT_LOG.md`.

---

# PART I — THE VISION

## 1. What Is LORE?

LORE is a social application designed to help people create, organize, experience, document, and preserve meaningful moments in their lives.

It combines:

- Personal and shared calendars
- Event planning
- Spontaneous activity coordination
- Friend groups and communities
- Collaborative journals
- Personal and shared histories
- Maps of experiences
- Traditions
- Achievements
- Adventures and expeditions
- Interactive social memories
- Long-term personal archives
- A distinctive Lore Score system

LORE is not intended to become another conventional social media platform.

Its primary function is to facilitate real-world experiences and preserve the stories that emerge from them.

The application must remain useful before, during, and long after an experience.

**Central principle:** The application exists to enrich people's lives outside the application.

It should help users spend more time doing things worth remembering, rather than consuming endless digital content.

## 2. The Problem

Existing social platforms often prioritize content consumption, attention, engagement metrics, and algorithmic feeds.

Event platforms primarily organize events. Calendar applications primarily organize time. Photo applications primarily store media. Messaging applications facilitate communication but often bury important plans, photographs, memories, and decisions inside conversations.

LORE connects these otherwise fragmented activities.

Consider a typical group of friends: Someone suggests an adventure in a group chat. Everyone gets excited. The conversation moves on. Three months later, nobody remembers the idea.

Or perhaps the adventure actually happens. Photographs end up on different phones, videos disappear into message histories, and the funniest details survive only in people's memories. Years later, reconstructing what happened becomes difficult.

LORE should solve both problems.

**Make the experience happen. Preserve what happened afterward.**

## 3. The Three Pillars

- **MAKE LORE** — Help people discover, suggest, organize, and participate in experiences.
- **REMEMBER LORE** — Preserve adventures, memories, photographs, stories, quotes, and personal history.
- **CONNECT LORE** — Connect people, places, experiences, groups, traditions, and historical moments.

Every major feature should support at least one of these pillars.

## 4. Product Philosophy

LORE operates according to the following principles.

- **No infinite scrolling.** There should be no conventional endless algorithmic feed.
- **Life comes first.** The application should encourage real-world participation rather than prolonged passive consumption.
- **Experiences over popularity.** Follower counts, likes, and superficial engagement should not define success.
- **Memories are valuable.** LORE should make revisiting experiences enjoyable, intuitive, and meaningful.
- **Social without social pressure.** Users should not feel obligated to constantly post or maintain activity streaks.
- **Private by default.** Users must control access to their calendars, groups, events, locations, and memories.
- **Spontaneity matters.** Not every memorable experience starts with a plan.
- **History should be connected.** A photograph, person, event, and location should be able to reference the same shared experience.
- **People are more than profiles.** The application should represent relationships through shared experiences rather than popularity statistics.
- **The experience belongs to its participants.** LORE must not assume ownership over the stories people contribute.

---

# PART II — APPLICATION STRUCTURE

## 5. Primary Navigation

Proposed main navigation:

1. Home
2. Calendar
3. Create
4. Lorebook
5. Profile

Additional features should be accessible through contextual navigation. The entire application should not become an overwhelming collection of separate pages. For example:

- The Lore Map is accessible through the Lorebook.
- The Idea Vault can be accessed from Home or Crews.
- Achievements are accessible through profiles.
- Traditions are linked to calendars and groups.
- Expedition Mode is a specialized event type.

The precise navigation structure remains open to refinement.

---

# PART III — HOME

## 6. Home Screen

The Home screen should answer three questions: **What is happening? What could we do? What should I remember?**

Possible sections:

- **Coming Up** — Upcoming events involving the user.
- **Who's Down?** — Spontaneous invitations currently available.
- **Your Crews** — Quick access to groups and their activity.
- **Ideas Worth Doing** — Selected ideas from the user's personal or shared Idea Vault.
- **On This Day** — Relevant historical memories from previous years.
- **Continue Planning** — Upcoming events that still require decisions.
- **Recent Lore** — A small, finite collection of recently completed experiences involving the user. This must not become an infinite social feed.

All sections should be limited, actionable, and relevant. The Home screen should make it easy to leave the application and participate in life.

---

# PART IV — THE CALENDAR

## 7. Dual Calendar System

LORE should offer two separate but interconnected calendar layers.

### Personal Calendar

A private calendar for the user's existing commitments. Examples: work, school, appointments, personal tasks, private events, other commitments.

Users should eventually be able to connect external calendar providers. Possible integrations include Google Calendar, Apple Calendar, Microsoft Outlook. External synchronization should respect permissions and provider capabilities.

### LORE Calendar

A social calendar containing experiences, invitations, and events. Users can share relevant events with selected friends, specific crews, invitation-only groups, and larger communities, where permitted.

Private appointments should never become visible simply because calendars are connected.

### Availability

A user can optionally expose availability without revealing private event details. For example: *Friday: Available after 18:00.* Friends should not need access to the underlying private calendar entries.

### Calendar Views

Support: Day, Week, Month, Agenda, Crew calendar, Event-specific schedule.

### Calendar Functionality

Users should be able to: create events, invite participants, accept or decline invitations, express tentative interest, propose alternative dates, set reminders, add descriptions, attach locations, share equipment lists, add notes, set recurrence, assign organizers, edit eligible event details, view event participants, discuss relevant plans.

### Event Status

Suggested statuses: Idea, Proposed, Planning, Confirmed, In progress, Completed, Canceled, Postponed. Events should transition naturally between these states.

---

# PART V — THE EVENT SYSTEM

## 8. Events Are More Than Calendar Entries

Events are one of the central objects within LORE. An event may include:

- **Identity** — Title, description, cover image, creator, associated crew.
- **Schedule** — Date, start time, end time, time zone, recurrence.
- **Location** — Meeting point, destination, multiple stops, optional hidden location.
- **Participation** — Invited users, confirmed participants, tentative participants, maximum capacity, organizer roles.
- **Planning** — Checklist, equipment, shared responsibilities, important notes, estimated costs, optional expense tracking.
- **Communication** — Event discussion, announcements, polls, updates.
- **History** — Photographs, videos, stories, quotes, achievements, Lorebook chapter.

### Event Types

Proposed categories: Gathering, Party, Road trip, Expedition, Sports, Outdoor adventure, Creative project, Celebration, Competition, Tradition, Custom event.

Categories should remain flexible. Users should be able to create events without navigating complicated forms.

### Event Completion

Once completed, an event may become a Lorebook chapter. The original schedule, participants, and location can form the chapter's foundation. The system should preserve historical accuracy when event details change afterward.

---

# PART VI — WHO'S DOWN?

## 9. Spontaneous Activity System

Who's Down? enables rapid coordination.

Example: A user opens LORE and creates: **ROAD TRIP — RIGHT NOW.** They select activity, meeting point, approximate starting time, friends or crews, optional description, invitation expiration.

Recipients receive an invitation. Possible responses: **I'M DOWN**, **MAYBE**, **NOT TODAY**.

The invitation displays participants who have opted to reveal their participation. If enough people join, the activity can become an event.

### Optional Features

Availability-aware invitations, quick activity presets, expiring invitations, minimum participant thresholds, nearby friends (only with explicit opt-in), one-tap event conversion, spontaneous adventure achievements.

No location should be exposed without permission. LORE should never require users to continuously broadcast their whereabouts.

---

# PART VII — THE IDEA VAULT

## 10. The Idea Vault

The Idea Vault stores experiences that users want to have. An idea does not require a specific date or commitment.

Examples: Rent a cabin. Travel around Iceland. Build something ridiculous. Organize a tournament. Visit a particular destination. Start an annual tradition. Sail to a new location.

### Each Idea Can Contain

Title, description, creator, interested friends, associated crew, category, estimated budget, potential destinations, ideal season, required equipment, attachments, comments, polls.

### Idea Status

Dreaming, Gathering interest, Planning, Scheduled, Completed, Archived.

### Conversion

Ideas should be convertible into events without re-entering information.

**IDEA → PLAN → EVENT → EXPERIENCE → LORE.**

Completed ideas may retain links to their corresponding Lorebook chapters. The Idea Vault should prevent good ideas from disappearing into forgotten group conversations.

---

# PART VIII — CREWS

## 11. Social Groups

Groups within LORE are called Crews. A crew represents a collection of people who share experiences. Examples: close friends, travel companions, sports groups, families, adventure clubs, creative teams, school friends.

### Crew Identity

Name, description, icon, cover image, members, roles, privacy settings, creation date.

### Crew Workspace

Shared calendar, shared Idea Vault, shared Lorebook, group achievements, Crew Lore Score, traditions, expeditions, group challenges, Lore Map, Hall of Fame, Quote Archive.

### Membership

Suggested roles:

- **Owner** — Controls the crew's existence and primary settings.
- **Administrator** — Manages members and permitted group functions.
- **Member** — Participates according to crew permissions.

Permission settings should be configurable.

### Crew Privacy

Possible visibility modes: Private, Invite only, Discoverable with approval, Public (if public communities are introduced). Private crews should not be discoverable without permission.

---

# PART IX — THE LOREBOOK

## 12. Collaborative History

The Lorebook is one of the most important features in the application. It transforms completed experiences into permanent, organized memories. A Lorebook contains Chapters. Each chapter documents an experience.

### Chapter Structure

Title, date, cover image, description, participants, locations, photographs, videos, personal accounts, memorable quotes, achievements, related events, related chapters, associated traditions, associated crews.

### Chapter Creation

- **Automatic draft** — LORE generates a basic chapter from an event's existing information.
- **Manual creation** — A user documents an experience that was never scheduled in the application.
- **Collaborative creation** — Several participants contribute memories.

### Multiple Perspectives

Participants should be able to contribute their own versions of events.

Example — *Chapter: The Mysterious Disappearance of the Sausages*

- Participant A: "The sausages were there. Then they weren't."
- Participant B: "I told everyone not to trust Beggi."
- Participant C: "Allegations."

These accounts can coexist. The Lorebook is not required to enforce a single official narrative.

### Historical Connections

Chapters can link to earlier chapters, later chapters, relevant traditions, associated locations, shared participants, achievements, expeditions.

### Chapter Organization

Allow chronological browsing, filtering by participant, crew, location, year, category, and searching titles and content. The user should also be able to revisit experiences through an interactive timeline.

### Historical Import

Users should be able to create chapters for experiences that occurred before they joined LORE. The application should not require memories to originate from its own calendar.

---

# PART X — COLLABORATIVE STORYTELLING

## 13. Shared Narratives

LORE should support multiple contributors to a single chapter. Contributions may include written stories, photographs, videos, quotes, recollections, voice notes (if supported), corrections, additional context.

### Contribution Ownership

Users retain control over their own contributions, subject to clearly defined shared-history rules.

### Chapter Editing

Potential approach:

- Chapter organizers control the main structure.
- Participants can submit contributions.
- Contributors can edit their own material.
- Moderators can manage inappropriate content.
- Significant changes can maintain revision history.

### Shared Memories

A participant can optionally associate a chapter with their personal Lorebook. A single shared event should not require multiple independent copies of the same historical record. Instead, users' personal histories should reference the same chapter when appropriate.

---

# PART XI — THE QUOTE ARCHIVE

## 14. Legendary Quotes

LORE should allow users to preserve memorable statements. A quote can contain: quote text, speaker, date, associated event, associated chapter, contributing user, context, optional image.

Examples: A ridiculous statement made during a road trip. An inside joke that becomes part of group history. A sentence that becomes a crew's unofficial motto.

### Quote Discovery

Quotes can be accessed through participant profiles, crew pages, Lorebook chapters, the Quote Archive, historical search.

### Attribution

Quote attribution should be editable or disputable. Users should have control over whether quotations attributed to them can be shared outside their intended audience.

---

# PART XII — THE LORE SCORE

## 15. Purpose

The Lore Score is a proposed system for recognizing participation in memorable experiences. It must not become a conventional popularity metric. LORE should avoid making follower counts, likes, or posting frequency its primary signals. The Lore Score should celebrate experience rather than attention.

### Personal Lore Score

Potential factors: participating in experiences, organizing adventures, completing personal goals, participating in traditions, exploring new places, contributing to shared history, receiving special crew achievements.

### Crew Lore Score

A crew may accumulate a collective score. Potential factors: completed adventures, shared achievements, completed challenges, established traditions, collaborative milestones.

### Event Lore Score

Participants can optionally rate completed events. For example: *THE GREAT ROAD TRIP — Lore Score: 9.7/10.* This rating represents participating members' assessments of the experience. It is not necessarily a universal measure of quality.

### Proposed Lore Score Categories

- **Explorer** — Travel, exploration, and new destinations.
- **Creator** — Projects, activities, and events brought into existence.
- **Companion** — Shared experiences and group participation.
- **Historian** — Contributions to preserved history.
- **Spontaneity** — Unplanned adventures and unexpected experiences.
- **Tradition Keeper** — Participation in recurring group rituals.
- **Wildcard** — Unusual achievements and custom legendary moments.

### Important Design Questions

The exact scoring formula is not yet determined. Before implementation, decide: Should Lore Score be numerical? Should it be public? Should users be able to hide it? Are scores comparable between people? Can crews define custom scoring systems? Should highly subjective achievements award points? Should users be able to opt out?

### Anti-Abuse Principles

Avoid rewarding: creating meaningless events, spamming invitations, excessively posting content, collecting reactions, repeatedly rating one's own activities, dangerous or reckless behavior.

The system must never reward people for taking unnecessary risks to increase their scores. The objective is making memories, not farming points.

---

# PART XIII — ACHIEVEMENTS

## 16. Achievement System

Achievements recognize memorable experiences and milestones.

### Standard Achievements

Potential examples:

- **The Initiator** — Organize your first adventure.
- **The Entire Gang** — Successfully gather every member of a crew.
- **Uncharted Territory** — Visit a new destination as part of an adventure.
- **The Long Way Home** — Complete a memorable extended road trip.
- **Sunrise Survivor** — Experience a sunrise during an overnight group gathering.
- **Random Encounter** — Participate in an unplanned adventure.
- **Historian** — Contribute to a specified number of Lorebook chapters.
- **Tradition Founder** — Establish a recurring group activity.

### Custom Achievements

Crews can create personalized achievements. Examples: an award commemorating an unforgettable inside joke; an achievement unique to a particular member; an award established after an unusual group experience.

### Achievement Properties

Name, description, icon, creator, recipient, date, associated event or chapter, visibility, optional Lore Score value.

### Achievement Verification

LORE should not require invasive verification of ordinary experiences. Achievements can use event participation, user acknowledgment, crew recognition, organizer confirmation. Verification requirements, if any, should be proportionate to the feature.

---

# PART XIV — TRADITIONS

## 17. Recurring Experiences

Traditions are events or activities repeated over time. Examples: annual road trips, birthday gatherings, seasonal expeditions, weekly game nights, annual competitions, recurring reunions.

### Tradition Profile

Name, founding date, description, members, recurrence pattern, historical chapters, upcoming occurrence, achievements, optional tradition-specific statistics.

### Historical Timeline

For example — *THE ANNUAL HOMIE SUMMIT*: 2027 — Chapter I; 2028 — Chapter II; 2029 — Chapter III; 2030 — Chapter IV. Users can view the full history of the tradition.

### Tradition Continuity

A tradition should persist as a recognized entity even when a particular year is skipped. The application may remind organizers that the next occurrence is approaching.

---

# PART XV — GROUP RIVALRIES

## 18. Friendly Competition

Crews can participate in friendly competitions. Examples: sports tournaments, trivia events, creative challenges, outdoor competitions, group games, annual festivals.

### Rivalry Structure

Participating crews, competition title, rules, schedule, challenges, results, historical record, achievements, associated Lorebook chapters.

### Competitions

A rivalry may consist of several individual events. Example — *THE GREAT HOMIE OLYMPICS*, with categories: trivia, team sports, creative challenges, puzzle solving, outdoor games.

### Rivalry History

LORE records previous competitions and results. An annual competition can simultaneously be a tradition. The objective is to motivate people to organize activities together.

---

# PART XVI — THE LORE MAP

## 19. Geographic History

The Lore Map allows users to explore memories geographically. Users can view locations associated with their past experiences.

### Map Content

Completed adventures, Lorebook chapters, expedition routes, historical meeting points, saved destinations, planned adventures, crew memories.

### Example

A user opens a map of Iceland. They select Seyðisfjörður. A chapter associated with October 9, 2026, appears. The user can open the chapter and revisit the experience.

### Map Modes

- **Personal Map** — Experiences connected to the user.
- **Crew Map** — Shared experiences involving a selected crew.
- **Memory Map** — Only historical experiences.
- **Adventure Map** — Saved future destinations and planned experiences.

### Location Privacy

Users must be able to hide exact locations, use approximate locations, keep locations private, restrict sharing to selected participants, remove location associations, disable location-related features.

The map should not function as an involuntary tracking system.

---

# PART XVII — EXPEDITION MODE

## 20. Advanced Adventure Planning

Expedition Mode is a specialized form of event, intended for activities requiring more coordination. Examples: sailing expeditions, hiking trips, camping, road trips, multi-day travel, exploration, group adventures.

### Expedition Workspace

- **Overview** — Mission, description, participants, and objectives.
- **Calendar** — Departure, milestones, and return.
- **Route** — Destinations, checkpoints, and planned stops.
- **Crew** — Participants and assigned responsibilities.
- **Equipment** — Packing lists and shared inventory.
- **Planning** — Notes, checklists, and important information.
- **Expenses** — Optional budgets and shared expenses.
- **Expedition Log** — Notes, photographs, and relevant experiences.
- **Milestones** — Objectives and achievements.
- **Lorebook** — Post-expedition history.

### Expedition Duration

A few hours, one day, a weekend, several weeks, longer periods.

### Offline Functionality

A future implementation should support offline access to previously saved expedition information. Where technically feasible, users could collect notes and media without connectivity and synchronize later. Offline support is particularly valuable during remote adventures.

---

# PART XVIII — THE HALL OF LORE

## 21. Hall of Fame

Each crew may have a Hall of Lore: a curated collection of particularly memorable experiences.

Potential categories: Greatest Adventure, Funniest Incident, Most Unexpected Event, Best Tradition, Legendary Quote, Most Memorable Expedition, Historic Crew Achievement.

### Nominations

Members may nominate eligible chapters.

### Selection

A crew may choose member voting, administrator curation, rotating recognition, or unranked collections. The Hall of Lore should not require numerical rankings. Some memories are better preserved without competition.

### Historical Preservation

Once selected, an entry becomes part of the group's history. Entries can be revisited years later.

---

# PART XIX — TIME CAPSULES

## 22. The Lore Capsule

LORE Capsules preserve selected content for future viewing. A capsule may contain written messages, photographs, videos, predictions, memories, shared reflections, group contributions.

### Capsule Configuration

Name, creator, participants, creation date, unlock date, visibility, contribution permissions.

### Example

A crew creates a capsule in 2026. Each member adds a message to their future self. The capsule is scheduled to unlock in 2036. Participants receive a notification when the capsule opens.

### Technical Considerations

Time capsules require reliable long-term storage. The product must not promise permanent availability without having the infrastructure and policies necessary to support that commitment. Users should eventually be able to export their capsules.

---

# PART XX — THE SOCIAL UNIVERSE

## 23. Connected Personal Histories

LORE should treat people, experiences, locations, groups, and memories as interconnected entities. This enables rich historical navigation.

### Example

A user opens a friend's profile. The application may display adventures experienced together, shared chapters, shared traditions, shared achievements, shared expedition history, shared locations, quotes associated with both participants.

### Shared History

Each relationship can have an optional shared-history view. This is not intended as a numerical measurement of friendship. It is an archive of experiences involving those people.

### Connected Chapters

A chapter may be associated with multiple profiles, multiple crews, multiple locations, multiple achievements, one or more traditions. A chapter should not need to be duplicated for each participant.

### Search

Users should eventually be able to search their accessible history by name, date, location, event, crew, quote, chapter, category. Search must respect all privacy permissions.

---

# PART XXI — USER PROFILES

## 24. Personal Identity

Each user has a profile. Potential fields: display name, username, profile photograph, biography, optional location, friend connections, crew membership, Lorebook, achievements, Lore Score, personal timeline.

### Profile Philosophy

A profile should emphasize experiences rather than social popularity.

### Profile Sections

- **About** — Basic user information.
- **My Lore** — Accessible historical chapters.
- **My Crews** — Associated groups.
- **Achievements** — Personal accomplishments.
- **Lore Score** — Optional scoring information.
- **Shared History** — Experiences involving the profile visitor and owner.
- **Map** — Locations the user has chosen to share.

### Privacy

Every major profile component should support appropriate visibility controls.

---

# PART XXII — FRIEND CONNECTIONS

## 25. Friend System

LORE should support explicit friend connections. Possible actions: send friend request, accept request, decline request, remove friend, block user, invite friend to crew, invite friend to event.

### Friend Discovery

Potential methods: username search, invitation links, QR codes, mutual friends (when permitted), contact matching (only with explicit permission). The application should not upload entire contact lists without informed consent.

### Connections and Participation

Users do not necessarily need to be friends to attend the same event. Event access and friendship should be separate concepts.

---

# PART XXIII — COMMUNICATION

## 26. Communication Features

LORE needs sufficient communication functionality to support planning. However, it does not necessarily need to replace every messaging application.

### Suggested Initial Features

Event discussion threads, crew announcements, comments on ideas, comments on chapters, polls, invitations, participant updates.

### Future Possibilities

Direct messaging, crew group chats, voice notes, shared media conversations.

A full messaging platform should not automatically become an MVP requirement. The primary objective is coordinating experiences.

---

# PART XXIV — NOTIFICATIONS

## 27. Useful Notifications Only

Notifications should exist to communicate meaningful information. Examples: event invitation, event cancellation, schedule change, event reminder, new contribution to a shared chapter, invitation to join a crew, important expedition update, time capsule opening, tradition approaching.

### Notification Controls

Users should be able to configure push notifications, email notifications, quiet hours, notification categories, crew-specific preferences.

### Engagement Philosophy

Avoid notifications that manufacture urgency. Examples of undesirable behavior: guilt-inducing inactivity reminders, artificial engagement prompts, repeated messages demanding attention, streak-loss warnings, spammy recommendations.

LORE should respect the user's attention.

---

# PART XXV — CREATION TOOLS

## 28. The Universal Create Button

One central creation interface should allow users to initiate different kinds of activities. Potential options:

- **Create Event** — Schedule an activity.
- **Who's Down?** — Invite friends immediately.
- **Add Idea** — Save something worth doing.
- **Create Chapter** — Record an experience.
- **Start Expedition** — Organize an adventure.
- **Create Crew** — Establish a group.
- **Create Tradition** — Start a recurring event.
- **Create Capsule** — Preserve something for the future.

The interface should prioritize frequently used actions and avoid unnecessary complexity.

---

# PART XXVI — THE LORE ENGINE

## 29. Connected Experience Lifecycle

The Lore Engine is the system connecting the application. It does not necessarily require artificial intelligence.

Its central lifecycle is: **IDEA → PLAN → EVENT → EXPERIENCE → CHAPTER → LEGACY**

1. **Idea** — Someone suggests an activity.
2. **Planning** — Friends express interest and organize details.
3. **Event** — A scheduled experience is created.
4. **Participation** — The event takes place.
5. **Documentation** — Participants contribute memories and media.
6. **Chapter** — The shared history is preserved.
7. **Legacy** — Achievements, traditions, maps, and historical connections are updated where appropriate.
8. **Continuation** — The experience may inspire future ideas or recurring events.

### Important Exception

Users must not be forced through every stage. An idea can remain an idea. A spontaneous experience can become a chapter without ever having been scheduled. An event can occur without anyone documenting it. A memory can be added years afterward.

The lifecycle provides structure, not mandatory bureaucracy.

---

# PART XXVII — USER EXPERIENCE DESIGN

## 30. Visual Identity

LORE should have a distinctive visual identity. The name itself suggests history, adventure, stories, mythology, personal identity, discovery, time, connection. However, the interface should remain modern and practical.

### Possible Design Direction

A combination of:

- **Digital journal** — Personal, memorable, organized.
- **Adventure application** — Energetic and action-oriented.
- **Social coordination platform** — Fast, clear, functional.
- **Historical archive** — Searchable and interconnected.

### Visual Elements

Potential motifs: chapters, books, maps, compasses, timelines, badges, expedition markers, connected points, historical records. These should not overwhelm everyday usability.

### Interface Requirements

Mobile-first design, responsive layouts, clear typography, accessible contrast, fast event creation, minimal navigation friction, dark and light themes, clear privacy indicators, consistent interaction patterns.

### Tone

LORE can have personality. It should feel energetic, adventurous, and fun. However, users should be able to use it for ordinary experiences without feeling pressured to make everything sound extraordinary.

---

# PART XXVIII — PRIVACY, SAFETY, AND CONTROL

## 31. Privacy Requirements

Privacy is foundational because LORE may contain sensitive personal history. Potentially sensitive information includes personal schedules, private social connections, home locations, travel plans, photographs, personal messages, historical whereabouts.

### Essential Requirements

- **Private by default** — Newly created personal content should not automatically become public.
- **Granular sharing** — Users choose which friends or crews can access information.
- **Calendar separation** — Personal calendar entries remain private unless deliberately shared.
- **Location control** — Users control whether exact or approximate locations are disclosed.
- **Consent-based media sharing** — Participants should have ways to request removal or restricted visibility of content involving them.
- **Blocking and reporting** — Users need basic safety and moderation controls.
- **Account deletion** — Users must be able to request account deletion.
- **Data export** — Users should eventually be able to retrieve their own content in usable formats.

### Historical Content Deletion

A difficult product question: What happens when one participant leaves a crew or deletes their account?

Suggested principle: Removing a user's account should remove their personal information according to the product's deletion policy, without automatically erasing every other participant's independently owned memories.

This requires a deliberate content ownership and shared-history policy.

---

# PART XXIX — TECHNICAL ARCHITECTURE

## 32. Development Approach

The exact technology stack has not been chosen. The following is a proposed architecture suitable for evaluation.

### Frontend

A mobile-first application. Possible approaches: React Native with Expo, Flutter, progressive web application, web application followed by native clients.

### Backend

A backend responsible for authentication, user profiles, friend connections, crews, events, invitations, Lorebook content, access permissions, media metadata, achievements, scoring, notifications.

Possible technologies: TypeScript, Node.js, PostgreSQL, Supabase, other suitable managed services.

### Media Storage

Media should be stored in object storage rather than directly inside relational database rows. Media records should reference the relevant stored files.

### Real-Time Features

Potential real-time functionality: RSVP updates, event discussion, crew activity, collaborative updates, spontaneous invitation responses.

### Calendar Integration

External calendar integration should be designed as a separate integration layer. The system should account for authorization, time-zone handling, duplicate events, sync conflicts, revoked permissions, different calendar provider capabilities.

### Architecture Philosophy

Begin with a maintainable application. Avoid unnecessarily complex infrastructure before product requirements justify it.

---

# PART XXX — PROPOSED DATA MODEL

## 33. Core Entities

The initial data model could contain the following conceptual entities.

| Entity | Represents | Key fields |
|---|---|---|
| User | An account | ID, username, display name, profile information, creation date, preferences |
| Friendship | A relationship between accounts | Requesting user, receiving user, status, creation date |
| Crew | A social group | ID, name, description, owner, visibility, creation date |
| Crew Membership | Connects users to crews | Crew ID, user ID, role, membership status |
| Event | A planned or completed experience | ID, title, description, start, end, time zone, creator, location, status, visibility |
| Event Participant | Connects users to events | Event ID, user ID, RSVP status, role |
| Idea | An unscheduled activity proposal | ID, creator, title, description, status, crew association, visibility |
| Chapter | A historical experience | ID, title, description, date, creator, associated event, visibility |
| Chapter Contribution | A participant's contribution | Chapter ID, contributor, contribution type, content, creation date |
| Media | Uploaded photographs and videos | ID, owner, storage reference, media type, metadata, visibility |
| Location | A place associated with an experience | ID, name, coordinates (when appropriate), approximation level |
| Achievement | Defines an achievement | ID, title, description, type, creator, optional score value |
| Achievement Award | Records the awarding of an achievement | Achievement ID, recipient, awarding entity, date, related event or chapter |
| Tradition | A recurring experience | ID, title, creator, recurrence, associated crew |
| Expedition | Specialized adventure planning data | Event ID, objectives, route, equipment, planning information |
| Quote | A memorable statement | ID, text, speaker, contributor, date, related chapter |
| Lore Capsule | A time-locked collection | ID, creator, unlock date, visibility, status |
| Lore Score Record | Scoring decisions or score changes | ID, recipient, source, category, value, date |
| Notification | A relevant application notification | |
| Access Policy | Who can access specific content | |
| Audit History | Important permission or content-management changes, where necessary | |

---

# PART XXXI — RELATIONSHIPS BETWEEN ENTITIES

## 34. Relational Structure

The application should support these connections:

- A user can belong to many crews. A crew can contain many users.
- A user can participate in many events. An event can have many participants.
- An event may produce a chapter.
- A chapter can have multiple contributors, multiple media files, and reference multiple locations.
- An idea can become an event.
- An event can belong to a tradition. A tradition can contain multiple events.
- An expedition extends an event.
- An achievement can reference an event or chapter.
- A quote can reference a chapter.
- A Lore Capsule can contain contributions from multiple users.
- A chapter can be associated with multiple users and crews.

The system should avoid duplicating shared historical records unnecessarily.

---

# PART XXXII — DEVELOPMENT ROADMAP

## 35. Development Strategy

Not every proposed feature belongs in the initial release. The application should be developed in stages. The first goal is to establish a useful, connected product.

### PHASE 1 — THE FOUNDATION

**Objective:** Enable friends to organize experiences and preserve them.

Core features:

1. User registration and authentication
2. User profiles
3. Friend connections
4. Crews
5. Basic personal calendar
6. Shared LORE calendar
7. Event creation
8. Event invitations
9. RSVP system
10. Basic event discussions
11. Idea Vault
12. Idea-to-event conversion
13. Basic Lorebook
14. Chapter creation
15. Photo uploads
16. Collaborative chapter contributions
17. Basic notifications
18. Privacy and permissions
19. Responsive application interface

**Phase 1 Success Condition** — A user can: create a crew; invite friends; suggest an idea; turn that idea into an event; coordinate attendance; complete the event; create a chapter documenting what happened; share that chapter with its participants; revisit it later. This is the first complete LORE experience.

### PHASE 2 — SPONTANEITY AND IDENTITY

**Objective:** Make the application more expressive and socially useful.

1. Who's Down?
2. Spontaneous invitations
3. Quote Archive
4. Achievements
5. Custom achievements
6. Basic Lore Score
7. Shared-history views
8. Improved profile customization
9. Event ratings
10. Enhanced historical search

**Success Condition** — Users can organize spontaneous experiences and recognize memorable moments through personalized history and achievements.

### PHASE 3 — THE LIVING WORLD

**Objective:** Connect history with geography and recurring experiences.

1. Lore Map
2. Traditions
3. Tradition timelines
4. Hall of Lore
5. Crew challenges
6. Friendly rivalries
7. Advanced event categories
8. Expanded media organization
9. Calendar provider integrations

**Success Condition** — Users can explore the development of their friendships, traditions, and adventures across time and location.

### PHASE 4 — EXPEDITIONS AND LEGACY

**Objective:** Expand LORE into a complete long-term adventure and memory platform.

1. Expedition Mode
2. Route planning
3. Equipment management
4. Expedition logs
5. Offline expedition features
6. Time Capsules
7. Advanced Lore Score functionality
8. Data export
9. Historical imports
10. Expanded collaboration and archive tools

**Success Condition** — LORE supports everything from spontaneous local gatherings to extensive expeditions and long-term personal archives.

---

# PART XXXIII — MONETIZATION

## 36. Business Model

Monetization has not been determined. Potential options include:

- **Free Core Application** — Essential social planning and memory features remain accessible.
- **Optional Premium Features** — Potential examples: additional cloud media storage, enhanced expedition tools, expanded archive exports, advanced customization, specialized crew management features.

### Important Constraint

LORE should not sell artificial social status. Users should not be able to purchase achievements or Lore Score superiority. Core functionality should not depend on advertising-driven engagement.

Any future business model must remain compatible with the principle: **No scrolling. Only rolling.**

---

# PART XXXIV — LONG-TERM POSSIBILITIES

## 37. Future Concepts

These are potential extensions, not approved requirements.

- **Historical Recollections** — Surface meaningful past experiences when relevant.
- **Collaborative Yearbooks** — Generate an annual summary of a crew's adventures.
- **Personal Autobiographies** — Organize years of experiences into readable life chapters.
- **Printable Lorebooks** — Export selected chapters into physical books.
- **Event Templates** — Save reusable formats for frequently organized activities.
- **QR Invitations** — Join events through invitation codes.
- **Public Community Events** — Discover selected events outside existing friend groups.
- **Crew Milestone Celebrations** — Recognize anniversaries and long-term traditions.
- **Personal Goals** — Connect experiences to personal objectives.
- **Optional AI Assistance** — Potential uses: organizing chapter drafts, helping summarize event contributions, searching personal archives, suggesting relevant ideas from saved interests, organizing expedition planning.

AI must not fabricate historical events or present generated recollections as real memories. Users must retain control over their personal information.

---

# PART XXXV — WHAT LORE MUST NOT BECOME

## 38. Anti-Features

The following are explicit product boundaries.

- **No Endless Algorithmic Feed** — Do not build the application around infinite scrolling.
- **No Engagement Farming** — Do not optimize primarily for screen time.
- **No Forced Posting** — Users should not feel required to publish their lives.
- **No Artificial Popularity Hierarchy** — Follower counts and likes must not define personal worth within the application.
- **No Mandatory Public Sharing** — Meaningful experiences can remain entirely private.
- **No Unnecessary Location Surveillance** — The application must not continuously monitor users without a clear, optional purpose.
- **No Punitive Streaks** — Users should not be penalized for living offline.
- **No Unnecessary Complexity** — Creating an ordinary event should remain simple.
- **No Mandatory Gamification** — Lore Scores and achievements should complement the experience, not dominate it.

---

# PART XXXVI — DESIGN DECISIONS STILL OPEN

## 39. Unresolved Questions

The following require deliberate product decisions before or during development.

- **Identity** — Final logo, brand colors, typography, visual style, profile appearance.
- **Platform** — Web first or mobile first; native applications or cross-platform; initial operating systems.
- **Calendar** — Whether LORE hosts a fully independent personal calendar; which external provider to integrate first; how shared availability works.
- **Lore Score** — Exact scoring formula; visibility; optional participation; anti-manipulation measures.
- **Crews** — Maximum group size; roles; membership permissions; public community functionality.
- **Lorebook** — Editing permissions; chapter ownership; historical revisions; shared media deletion rules.
- **Communications** — Whether direct messaging is necessary; how discussions are organized; notification preferences.
- **Storage** — Free storage limits; media compression; long-term archive policies; export options.
- **Business** — Monetization; hosting budget; expected scale; premium functionality.

These questions should not prevent development of the foundational experience.

---

# PART XXXVII — CLAUDE DEVELOPMENT DIRECTIVE

## 40. Instructions for the Development Assistant

You are assisting with the development of LORE, a social experiences and collaborative memory application. Treat this document as the initial product specification. Your objective is to help transform the product vision into a functioning, maintainable application.

### Development Requirements

1. **Preserve the product philosophy.** LORE is not a traditional social media platform. Do not introduce infinite feeds, attention-maximizing mechanisms, or unnecessary engagement features.
2. **Establish a coherent architecture.** Design the application around reusable data models and clear relationships between features.
3. **Prioritize the complete experience lifecycle.** The first implementation should support: Idea → Event → Participation → Lorebook Chapter.
4. **Avoid premature feature expansion.** Implement the foundational workflow before developing advanced scoring, expeditions, or complex social features.
5. **Maintain privacy boundaries.** Access control must be enforced by the backend, not merely hidden in the user interface.
6. **Use real persistence.** Core application data must be stored reliably. Do not treat a visual prototype as a complete product.
7. **Keep the interface fast.** Ordinary event creation and participation should require minimal interaction.
8. **Build for future connections.** The data architecture should allow events, chapters, locations, people, and achievements to reference each other.
9. **Document implementation decisions.** Maintain technical documentation explaining architectural choices.
10. **Distinguish implementation from proposal.** Do not silently convert every speculative feature into a development requirement.

### Requested Initial Technical Deliverables

Before major feature implementation, produce:

1. Recommended technology stack and justification.
2. Application architecture.
3. Initial database schema.
4. Authentication approach.
5. Privacy and permissions model.
6. Navigation structure.
7. Phase 1 implementation plan.
8. Development environment configuration.
9. Project folder structure.
10. Initial functioning application foundation.

### Implementation Quality

Use: typed interfaces where appropriate, maintainable components, reusable services, structured database migrations, input validation, server-side authorization, appropriate error handling, secure authentication practices, responsive layouts, automated testing for critical functions, clear development documentation.

Prioritize working software over elaborate mockups.

---

# PART XXXVIII — SUCCESS CRITERIA

## 41. How We Know LORE Works

LORE succeeds when users can:

- **Make plans easily.** An idea can become an organized event without tedious coordination.
- **Gather their friends.** Invitations and participation are simple.
- **Act spontaneously.** People can organize activities without extensive preparation.
- **Remember experiences.** Meaningful memories remain accessible.
- **Build shared history.** A group develops a collective archive of its experiences.
- **Reconnect with the past.** Users can discover events and moments they had almost forgotten.
- **Create traditions.** One experience can become something people repeat for years.
- **Spend less time managing social life digitally.** The application facilitates activities without requiring constant attention.

### Product Measurement

Useful metrics could include: events successfully organized, invitation-to-participation conversion, ideas converted into actual events, completed events documented, shared chapters revisited over time, active crews organizing recurring activities, user satisfaction with planning and memory preservation.

Do not treat time spent inside the application as the primary success metric.

---

# PART XXXIX — THE PRODUCT IN ONE EXAMPLE

## 42. A Complete LORE Experience

Four friends create a crew. They name it: **THE ABSOLUTE LEGENDS.**

One member opens the Idea Vault. They add: **WE SHOULD RENT A CABIN THIS WINTER.** The other members express interest.

A few weeks later, the creator converts the idea into an event. A date is selected. The event appears on the crew's shared calendar. Everybody confirms attendance. A packing list is created.

The weekend arrives. The group travels to the cabin. Unexpectedly, the weekend becomes one of their most memorable adventures.

After returning home, the organizer opens the completed event. They select: **CREATE LORE CHAPTER.** The application creates a draft. Everyone adds photographs, recollections, and quotes. The group titles the chapter: **THE CABIN INCIDENT.** Members add their different perspectives.

Someone nominates the chapter for the Hall of Lore. Another member suggests doing it again next year. The original event becomes the foundation of a new annual tradition.

Twelve months later, LORE reminds the crew that the anniversary is approaching. A new event is created. Another adventure happens. Another chapter is written.

Years pass. The group eventually has a complete history of its annual cabin adventures. Friendships evolve. People move. Life changes. But the history remains.

This is what LORE is supposed to make possible.

---

# PART XL — THE CORE IDENTITY

## 43. What Makes LORE Different?

LORE combines features traditionally spread across several applications. But its primary distinction is not the feature list. It is the connection between action and memory.

A conventional calendar records when something should happen. A messaging application helps people discuss it. An event platform organizes participation. A photo application stores images afterward. A social network allows people to publish selected moments.

LORE connects the entire experience: the suggestion, the planning, the participants, the event, the memories, the stories, the places, the traditions, the history. All within one coherent social environment.

And unlike platforms built around a continuously updating content feed, LORE should remain valuable even when nobody is actively posting. The application becomes more meaningful as its users accumulate genuine shared experiences.

---

## FINAL PRODUCT STATEMENT

**LORE — NO SCROLLING. ONLY ROLLING.**

LORE is a social application for people who want to create experiences, connect with others, and preserve the stories of their lives.

It combines calendars, spontaneous invitations, events, friend groups, adventure planning, collaborative journals, memories, achievements, maps, traditions, and personal histories.

Its fundamental purpose is to connect the future people imagine with the experiences they live and the memories they preserve.

It is not designed to replace real life with digital interaction. It is designed to make real life easier to organize, more enjoyable to share, and harder to forget.

**MAKE LORE. REMEMBER LORE. CONNECT LORE.**

**NO SCROLLING. ONLY ROLLING.**

*END OF MASTER PRODUCT BLUEPRINT — VERSION 0.1*

---

## Addendum — decisions from the product owner (2026-10-18)

- **The name:** LORE stands for **Life Of Regular Epics**: ordinary moments that turn out to be legendary.
  Used on the welcome screen, in the desktop navigation, in the app's install description and in the README
  (the owner may trim these by taste).
- **Integrations:** Connecting other apps to LORE goes through the owner's **Cardboard** app (https://github.com/Gosinn/Cardboard). Cardboard is still in development, so the Cardboard integration is scheduled for the **very end** of the roadmap.
- **Platform:** Web app first, then a real (native) app as soon as possible. It must be actually deployable.
- **Backend:** Own API + PostgreSQL (no Supabase).
