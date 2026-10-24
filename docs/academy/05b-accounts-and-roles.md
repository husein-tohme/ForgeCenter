# 5b. Accounts, roles, inboxes and messages in detail

Builds on [document 5](05-money-and-legal.md). Where ForgeCenter already has a rule (verified emails only, age outcomes only, suspended accounts can still appeal), CodeHub keeps it.

## One account, many ways in

- Each person has **one account** and can link several sign-ins to it: Google, Microsoft/Outlook, Discord, WhatsApp, GitHub.
- Sign-in uses the standard secure flow (OAuth with PKCE, a single-use state, and a cookie tying the reply to the same browser), as ForgeCenter's `oauth.js` does.
- **An email is trusted only when the provider verified it.** Microsoft school and work emails are not verified, so they never match or merge accounts on their own.
- WhatsApp accounts have a phone number instead of an email.

### Sessions

- Sign-in cookies are `httpOnly` and secure, and a new session ID is issued at every sign-in.
- A **devices page** lists where you're signed in, with "sign out everywhere".
- An email or notification goes out when a new device signs in.

### Extra security

| Who | Two-step login |
|---|---|
| Owner and all staff roles | **Required**: passkey or authenticator app |
| Teachers and school admins | Required |
| Everyone else | Optional, encouraged |

Passkeys (Face ID, fingerprint or a security key) are offered first, because they can't be phished.

## Age

- At sign-up: "When's your birthday?" The site keeps only the outcome (**under 13**, **13–17** or **adult**), never the date, as ForgeCenter does.
- **Under 13:** can't sign up alone. They join through a **school** (the school consents for classroom use) or a **parent** who creates and controls the account. Children's privacy laws (COPPA in the US, GDPR-K in the EU, the UK Children's Code) set exact rules for this consent, so get a lawyer to check this flow before opening it to under-13s.
- **13–17:** full learning, with the message and upload rules below.
- **Adult:** everything, including advanced hacking labs once verified.
- Owners are treated as adults, as in ForgeCenter.

## Students

1. Enter a school email.
2. A code is sent to it; entering it confirms the account as a **verified student**.
3. School email domains are checked against a public list of universities and schools (for example, the open "university domains" list), plus domains added by schools that join.
4. Verification lasts a year, then asks again.
5. Graduating students are offered the discount from document 5.

A verification service (SheerID, UNiDAYS) can be added for schools without their own email.

## Teachers, schools and parents

- **Teachers and school admins** apply with their school email and a link to proof (for example, the school's staff page). **Only the owner approves them**, from the owner panel.
- **Classes:** a teacher creates a class and gets a join code; students join with it. Teachers see only their own classes.
- **Schools:** a school admin sees their school's teachers, classes and billing, and nothing else.
- **Parents** link to a child's account with a code shown on the child's account, or by creating the account for an under-13. Parents see progress and who their child can message, not the messages themselves, unless a safety report involves them.

## Roles

Stored as role grants, each with a scope:

| Role | Scope |
|---|---|
| Owner | The whole site (one person) |
| Admin, Moderator, Support staff, Content reviewer | The whole site |
| School admin | One school |
| Teacher | One school, and their own classes |
| Creator, Student, Verified student, Parent | Their own account (Parent also covers linked children) |

- **Only the owner can grant or remove roles.** This is checked on the server for every role change, never only in the interface.
- Automatic roles (Student, Verified student, Creator) are granted by the system, never by staff.
- Every grant and removal is written to an **audit log** that can't be edited, including who did it and when.

### What each role can do

| Action | Owner | Admin | Mod | Support | Reviewer | School admin | Teacher | Creator | Student | Parent |
|---|---|---|---|---|---|---|---|---|---|---|
| Grant or remove roles | ✓ | | | | | | | | | |
| Money, prices, payouts | ✓ | | | | | Own school's billing | | Own tips | | |
| Site settings | ✓ | ✓ | | | | | | | | |
| Manage tracks and lessons | ✓ | ✓ | | | | | | | | |
| Approve lessons, docs, uploads | ✓ | ✓ | | | ✓ | | | | | |
| Hide content, suspend users | ✓ | ✓ | ✓ | | | | | | | |
| Answer support tickets | ✓ | ✓ | | ✓ | | | | | | |
| View an account (read-only, logged) | ✓ | ✓ | ✓ | ✓ | | Own school | Own classes | | | Linked children |
| Create classes, assign work | ✓ | | | | | ✓ | ✓ | | | |
| Upload videos | ✓ | ✓ | | | | | ✓ | ✓ | ✓ | |
| Learn, build, rate, comment | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |

- When staff view an account, it's logged, and the user can see that it happened in their account's activity.
- **Owners can't be suspended.** Suspended accounts can still open support tickets to appeal, but can't delete themselves (as in ForgeCenter).

## Inboxes

One notifications system feeds every inbox:

| Inbox | Gets |
|---|---|
| Notifications | Replies, badges, streaks, challenge results, new videos from followed creators |
| Class | Teacher announcements, assignments, class questions |
| Creator | Comments, video requests, tips |
| Support | Ticket replies (AI first, then a person) |
| Tutor history | Every past AI conversation, searchable |

- **Where it's delivered:** on the site, by email (a weekly summary by default), and as browser or phone notifications. Discord DMs from the CodeHub bot are optional.
- **Each type can be turned off**, and quiet hours stop notifications at night.
- **Under-18s never get marketing emails.** Their notifications are about learning only.

## Messages

### Who can message whom

| Sender ↓ / receiver → | Under 13 | 13–17 | Adult |
|---|---|---|---|
| Under 13 | Classmates only | Classmates only | Their teachers and parents only |
| 13–17 | Classmates only | Accepted friends and classmates | Their teachers and parents only |
| Adult | Their own students or children only | Their own students only | Accepted friends |
| Teacher | Their own students | Their own students | Anyone in their school |

- **Friend requests:** adults can't send friend requests to minors. Minors can accept requests only from other minors.
- **Links and images from non-friends are blocked.** Images in messages are off for under-13s.
- **The AI scans messages** for scams, grooming, bullying and personal details (phone numbers, addresses, schools). Clear cases are blocked before delivery; unsure ones go to a moderator.
- **Report, block and mute** on every message and profile. A report sends the moderator only the reported conversation, not the person's other messages.
- Teachers' class messages are visible to that school's school admin.
- Messages are kept for a set time (for example a year) and then deleted, unless they're part of an open report.

## Your data

- **Download your data**: lessons, projects, ratings, messages, tutor history.
- **Delete your account**: everything personal is removed. Payment records are kept as the law requires; ratings stay as anonymous numbers.
- Children's data is deleted when a parent or school asks.

## Data

```sql
CREATE TABLE identities (               -- several sign-ins per account
  user_id bigint NOT NULL,
  provider text NOT NULL,               -- google|microsoft|discord|whatsapp|github
  subject text NOT NULL,                -- the provider's ID for the person
  email text,                           -- only when the provider verified it
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE TABLE role_grants (
  user_id bigint NOT NULL,
  role text NOT NULL,                   -- admin|moderator|support|reviewer|school_admin|teacher|creator|student|verified_student|parent
  scope_kind text NOT NULL DEFAULT 'site',   -- site|school|class|user
  scope_id bigint,
  granted_by bigint,                    -- null for automatic roles
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,               -- verified students: a year
  UNIQUE (user_id, role, scope_kind, scope_id)
);

CREATE TABLE audit_log (                -- append-only: no updates or deletes
  id bigserial PRIMARY KEY,
  actor_id bigint NOT NULL,
  action text NOT NULL,                 -- role.grant, user.suspend, account.view, content.hide ...
  target_kind text NOT NULL,
  target_id bigint,
  details jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schools (id bigserial PRIMARY KEY, name text NOT NULL, email_domains text[] NOT NULL);
CREATE TABLE classes (
  id bigserial PRIMARY KEY,
  school_id bigint REFERENCES schools,
  teacher_id bigint NOT NULL,
  name text NOT NULL,
  join_code_hash bytea UNIQUE NOT NULL,
  homework_safe boolean NOT NULL DEFAULT true,
  labs_enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE class_members (class_id bigint NOT NULL REFERENCES classes, user_id bigint NOT NULL, PRIMARY KEY (class_id, user_id));
CREATE TABLE parent_links (parent_id bigint NOT NULL, child_id bigint NOT NULL, PRIMARY KEY (parent_id, child_id));
CREATE TABLE friendships (
  user_a bigint NOT NULL, user_b bigint NOT NULL,
  state text NOT NULL,                  -- requested|accepted|blocked
  PRIMARY KEY (user_a, user_b), CHECK (user_a < user_b)
);

CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL,
  inbox text NOT NULL,                  -- notifications|class|creator|support
  kind text NOT NULL,
  payload jsonb NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, inbox, created_at DESC);
CREATE TABLE notification_prefs (user_id bigint NOT NULL, kind text NOT NULL, channels text[] NOT NULL, PRIMARY KEY (user_id, kind));

CREATE TABLE conversations (id bigserial PRIMARY KEY, kind text NOT NULL, class_id bigint REFERENCES classes);  -- direct|class
CREATE TABLE conversation_members (conversation_id bigint NOT NULL REFERENCES conversations, user_id bigint NOT NULL, PRIMARY KEY (conversation_id, user_id));
CREATE TABLE messages (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations,
  sender_id bigint NOT NULL,
  body text NOT NULL,
  scan_state text NOT NULL,             -- clean|held|blocked
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL
);
```

## Risks

| Risk | What we do |
|---|---|
| A staff account gets hacked | Required passkeys or authenticator apps, new-device alerts, audit log, only the owner can grant roles |
| Adults contacting children | The message table above, no adult-to-minor friend requests, AI scanning, reports |
| Fake teachers | Owner approval with proof, school email, teachers see only their own classes |
| Breaking children's privacy laws | Under-13s only through schools or parents, outcomes not birthdays, a lawyer's check before opening |
| Staff snooping on accounts | Read-only access, every view logged and shown to the user |
| Accounts taken over through an unverified email | Verified emails only, as in ForgeCenter |
