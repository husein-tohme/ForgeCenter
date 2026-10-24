# 5. Money, accounts and legal

## Prices

| Plan | Price | Per month |
|---|---|---|
| First month offer | $1 | $1.00 |
| Monthly | $5 | $5.00 |
| 3 months | $12 | $4.00 |
| 6 months | $20 | $3.33 |
| Year | $35 | $2.92 |
| School, per student | About 30% more than the normal price (about $6.50/month), teacher tools included | — |

- **Free tier:** free lessons and videos, with a small daily AI limit.
- **Verified students:** free, confirmed by a code sent to their school email or by a verification service (SheerID, UNiDAYS). Checked again yearly. They keep the same daily AI limit as everyone. On graduating, they're offered a discount (for example, their first year for $15).
- **Regional prices:** cheaper in countries like Lebanon, India and Egypt.
- **Gift subscriptions and family plans.**
- **Invite rewards:** you and a friend both get a free month.
- **Other income later:** school plans, bookable mentors, job board posts, sponsored tracks.

## Payments

- Stripe, like ForgeCenter. Card numbers go straight to Stripe and are never stored or seen by the site, which only sees something like "Visa ending in 4242".
- A card box on the site's own pages with **Stripe Elements**, and saved cards with SetupIntents.
- **Stripe doesn't accept businesses based in Lebanon.** Until the owner moves to Europe or North America (possibly next year), everything is built and tested in Stripe test mode, and the free parts launch first. Turning on real payments is then mostly a settings change.
- **After the move: Stripe or Tebex.** Stripe fits subscriptions and schools best. Tebex is built for game stores (Minecraft servers and similar); check that it accepts a coding-school subscription before choosing it. Building the payment code behind one small module keeps either choice easy. Alternatives, if needed sooner: Paddle or Lemon Squeezy (check Lebanon payouts first), Stripe Atlas, or a trusted family member's account.

## Money planning

- Every AI answer costs money, so free use has a daily limit and the owner sees an AI cost dashboard.
- Own videos are hosted on the owner's YouTube channel (free, 4K), not self-hosted.
- Example from planning: 10,000 sign-ups at 2–5% paying is 200–500 paying users, roughly $1,000–$2,500 a month before fees and costs.

## Sign-in

- Google, Microsoft/Outlook, Discord, WhatsApp, GitHub, and university accounts (through Microsoft or Google). Nothing else; there's no "Sign in with OpenAI" for websites.
- Each button turns on when its keys are added. A setup page shows which are on and how to add the missing ones; GitHub has one-click setup like ForgeCenter's.
- The owner is set with `ADMIN_EMAILS` from day one; the one-time owner code is only a backup.
- A university login alone doesn't prove someone is a student (school Microsoft emails are unverified), so free student access always confirms the school email with a code.

## Roles

Only the owner gives or removes roles. Admins and staff can't.

| Role | What they can do |
|---|---|
| Owner | Everything: money, settings, roles |
| Admin | Runs the site day to day: tracks, users, staff (not money, not roles) |
| Moderator | Reviews reports, hides content, mutes or suspends users |
| Support staff | Answers tickets, can view an account but not change it |
| Content reviewer | Approves uploaded videos, docs and tracks |
| School admin | Manages their school's teachers, classes and billing |
| Teacher | Creates classes, assigns work, sees their own students' progress |
| Creator | Uploads videos, sees the creator dashboard, gets tips |
| Student | Learns, builds, rates, comments, messages friends |
| Parent | Sees their child's progress and controls messaging |
| Guest | Browses free lessons without an account |

- Automatic roles (not staff roles): Student on sign-up, Verified student after the school email check, Creator after the first upload.
- People can have several roles.
- Staff must use two-factor login, every staff action is logged, and staff never see card details.
- Teachers only see their own classes.
- Role badges are shown publicly so users know who to trust.

## Safety and privacy

- **Under 13:** only through a parent's or school's account (privacy laws in the US, UK and EU are strict).
- **No ID photos stored.** Student checks use school emails or a service that only answers "verified".
- **Message rules** for minors are in [document 2](02-features.md#inboxes-and-messages).
- **Hacking practice** only inside the site's own sandbox labs, with a rules page up front; advanced attack lessons for older or verified students.
- **Users can download or delete their data.**

## Legal pages

- Terms of service
- Privacy policy
- Refund policy
- Community rules (reusing ForgeCenter's `/rules`)
- Copyright takedown (DMCA) process for uploaded videos

## Brand and help

- **Name and domain:** not decided yet.
- **Look:** matches ForgeCenter's style.
- **Help:** a support page with AI first (reusing Forge Support), and moderators, possibly volunteers from the first students.
- **Marketing:** not part of the plan, by the owner's choice.

The full detail for sign-in, roles, inboxes and messages is in [document 5b](05b-accounts-and-roles.md).
