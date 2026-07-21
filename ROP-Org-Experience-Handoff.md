{\rtf1\ansi\ansicpg1252\cocoartf2870
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\froman\fcharset0 Times-Bold;\f1\froman\fcharset0 Times-Roman;\f2\fmodern\fcharset0 Courier;
\f3\fmodern\fcharset0 Courier-Bold;\f4\froman\fcharset0 TimesNewRomanPSMT;}
{\colortbl;\red255\green255\blue255;\red0\green0\blue0;\red108\green0\blue181;\red16\green19\blue24;
\red32\green36\blue45;\red14\green110\blue109;\red15\green112\blue1;\red4\green57\blue181;\red91\green98\blue116;
}
{\*\expandedcolortbl;;\cssrgb\c0\c0\c0;\cssrgb\c50588\c0\c76078;\cssrgb\c7843\c9412\c12157;
\cssrgb\c16863\c18824\c23137;\cssrgb\c0\c50196\c50196;\cssrgb\c0\c50196\c0;\cssrgb\c0\c31765\c76078;\cssrgb\c43137\c46275\c52941;
}
{\*\listtable{\list\listtemplateid1\listhybrid{\listlevel\levelnfc23\levelnfcn23\leveljc0\leveljcn0\levelfollow0\levelstartat0\levelspace360\levelindent0{\*\levelmarker \{disc\}}{\leveltext\leveltemplateid1\'01\uc0\u8226 ;}{\levelnumbers;}\fi-360\li720\lin720 }{\listname ;}\listid1}
{\list\listtemplateid2\listhybrid{\listlevel\levelnfc0\levelnfcn0\leveljc0\leveljcn0\levelfollow0\levelstartat1\levelspace360\levelindent0{\*\levelmarker \{decimal\}}{\leveltext\leveltemplateid101\'01\'00;}{\levelnumbers\'01;}\fi-360\li720\lin720 }{\listname ;}\listid2}
{\list\listtemplateid3\listhybrid{\listlevel\levelnfc23\levelnfcn23\leveljc0\leveljcn0\levelfollow0\levelstartat0\levelspace360\levelindent0{\*\levelmarker \{disc\}}{\leveltext\leveltemplateid201\'01\uc0\u8226 ;}{\levelnumbers;}\fi-360\li720\lin720 }{\listname ;}\listid3}
{\list\listtemplateid4\listhybrid{\listlevel\levelnfc23\levelnfcn23\leveljc0\leveljcn0\levelfollow0\levelstartat0\levelspace360\levelindent0{\*\levelmarker \{disc\}}{\leveltext\leveltemplateid301\'01\uc0\u8226 ;}{\levelnumbers;}\fi-360\li720\lin720 }{\listname ;}\listid4}}
{\*\listoverridetable{\listoverride\listid1\listoverridecount0\ls1}{\listoverride\listid2\listoverridecount0\ls2}{\listoverride\listid3\listoverridecount0\ls3}{\listoverride\listid4\listoverridecount0\ls4}}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\deftab720
\pard\pardeftab720\sa298\partightenfactor0

\f0\b\fs36 \cf0 \expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Run of Practice \'97 Org Experience Handoff\
\pard\pardeftab720\sa240\partightenfactor0

\fs24 \cf0 Status:
\f1\b0  Design finalized, ready for implementation\uc0\u8232 
\f0\b Scope:
\f1\b0  Org-level roles, team creation/staffing, org & coach library scoping, cross-team drill sharing, org-level equipment, coach invite flow, Org Home page\
\pard\pardeftab720\sa280\partightenfactor0

\f0\b\fs28 \cf0 0. Design Principles Carried Over From Existing Architecture\
\pard\tx220\tx720\pardeftab720\li720\fi-720\partightenfactor0
\ls1\ilvl0
\fs24 \cf0 \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 SECURITY DEFINER functions only.
\f1\b0  No direct table grants to 
\f2\fs26 anon
\f1\fs24 /authenticated for org/team/library data. All writes go through RPCs.\
\ls1\ilvl0
\f0\b \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Actor-identity forgery is the standing threat model.
\f1\b0  Every 
\f2\fs26 WITH CHECK
\f1\fs24  pins the actor to 
\f2\fs26 auth.uid()
\f1\fs24 , never a client-supplied user id.\
\ls1\ilvl0
\f0\b \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Full-copy over reference
\f1\b0  is established (
\f2\fs26 practice_activities
\f1\fs24  copies 
\f2\fs26 activity_library
\f1\fs24 ). We extend this to org library forking (\'a73.3) \'97 browsing is by reference, promotion is a fork.\
\ls1\ilvl0
\f0\b \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Polling over Realtime
\f1\b0  outside live-session contexts.\
\pard\pardeftab720\sa240\partightenfactor0
\cf0 Verify current column names against the live schema (project ref 
\f2\fs26 bepoojcbizxhqadrytjq
\f1\fs24 ) before migrating \'97 
\f2\fs26 activity_library
\f1\fs24 /
\f2\fs26 skill_tags
\f1\fs24  already have a hybrid global/org/coach scope concept this builds on.\
\pard\pardeftab720\sa280\partightenfactor0

\f0\b\fs28 \cf0 1. Role Model: Scoped Role Matrix\
\pard\pardeftab720\sa240\partightenfactor0

\fs24 \cf0 Decision:
\f1\b0  Reject flat global roles. Permissions are 
\f2\fs26 (role, scope)
\f1\fs24  pairs, not one tag on a profile \'97 this is what makes "Director who also coaches an unaffiliated team" fall out for free.\

\f0\b Two independent scope tiers:
\f1\b0 \

\itap1\trowd \taflags0 \trgaph108\trleft-108 \trbrdrt\brdrnil \trbrdrl\brdrnil \trbrdrr\brdrnil 
\clvertalc \clshdrawnil \clwWidth600\clftsWidth3 \clmart10 \clmarl10 \clmarb10 \clmarr10 \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadt20 \clpadl20 \clpadb20 \clpadr20 \gaph\cellx2880
\clvertalc \clshdrawnil \clwWidth2540\clftsWidth3 \clmart10 \clmarl10 \clmarb10 \clmarr10 \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadt20 \clpadl20 \clpadb20 \clpadr20 \gaph\cellx5760
\clvertalc \clshdrawnil \clwWidth1248\clftsWidth3 \clmart10 \clmarl10 \clmarb10 \clmarr10 \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadt20 \clpadl20 \clpadb20 \clpadr20 \gaph\cellx8640
\pard\intbl\itap1\pardeftab720\qc\partightenfactor0

\f0\b \cf0 Scope\cell 
\pard\intbl\itap1\pardeftab720\qc\partightenfactor0
\cf0 Table\cell 
\pard\intbl\itap1\pardeftab720\qc\partightenfactor0
\cf0 Roles (v1)\cell \row

\itap1\trowd \taflags0 \trgaph108\trleft-108 \trbrdrl\brdrnil \trbrdrr\brdrnil 
\clvertalc \clshdrawnil \clwWidth600\clftsWidth3 \clmart10 \clmarl10 \clmarb10 \clmarr10 \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadt20 \clpadl20 \clpadb20 \clpadr20 \gaph\cellx2880
\clvertalc \clshdrawnil \clwWidth2540\clftsWidth3 \clmart10 \clmarl10 \clmarb10 \clmarr10 \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadt20 \clpadl20 \clpadb20 \clpadr20 \gaph\cellx5760
\clvertalc \clshdrawnil \clwWidth1248\clftsWidth3 \clmart10 \clmarl10 \clmarb10 \clmarr10 \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadt20 \clpadl20 \clpadb20 \clpadr20 \gaph\cellx8640
\pard\intbl\itap1\pardeftab720\partightenfactor0

\f1\b0 \cf0 Org\cell 
\pard\intbl\itap1\pardeftab720\partightenfactor0

\f2\fs26 \cf0 org_staff
\f1\fs24  (new)\cell 
\pard\intbl\itap1\pardeftab720\partightenfactor0

\f2\fs26 \cf0 director
\f1\fs24 \cell \row

\itap1\trowd \taflags0 \trgaph108\trleft-108 \trbrdrl\brdrnil \trbrdrt\brdrnil \trbrdrr\brdrnil 
\clvertalc \clshdrawnil \clwWidth600\clftsWidth3 \clmart10 \clmarl10 \clmarb10 \clmarr10 \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadt20 \clpadl20 \clpadb20 \clpadr20 \gaph\cellx2880
\clvertalc \clshdrawnil \clwWidth2540\clftsWidth3 \clmart10 \clmarl10 \clmarb10 \clmarr10 \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadt20 \clpadl20 \clpadb20 \clpadr20 \gaph\cellx5760
\clvertalc \clshdrawnil \clwWidth1248\clftsWidth3 \clmart10 \clmarl10 \clmarb10 \clmarr10 \clbrdrt\brdrnil \clbrdrl\brdrnil \clbrdrb\brdrnil \clbrdrr\brdrnil \clpadt20 \clpadl20 \clpadb20 \clpadr20 \gaph\cellx8640
\pard\intbl\itap1\pardeftab720\partightenfactor0
\cf0 Team\cell 
\pard\intbl\itap1\pardeftab720\partightenfactor0

\f2\fs26 \cf0 team_staff
\f1\fs24  (existing)\cell 
\pard\intbl\itap1\pardeftab720\partightenfactor0

\f2\fs26 \cf0 coach
\f1\fs24 , etc.\cell \lastrow\row
\pard\pardeftab720\sa240\partightenfactor0
\cf0 A user can hold 
\f2\fs26 director
\f1\fs24  on 
\f2\fs26 org_staff
\f1\fs24  for Org A, 
\f2\fs26 coach
\f1\fs24  on 
\f2\fs26 team_staff
\f1\fs24  for Team X (in Org A), and 
\f2\fs26 coach
\f1\fs24  on 
\f2\fs26 team_staff
\f1\fs24  for Team Y (
\f2\fs26 org_id IS NULL
\f1\fs24 ) \'97 all at once, independently.\
\pard\pardeftab720\sa240\partightenfactor0

\f0\b \cf0 v1 role: 
\f3\fs26 director
\f0\fs24  only.
\f1\b0  No 
\f2\fs26 admin
\f1\fs24  role yet \'97 
\f2\fs26 org_staff.role
\f1\fs24  is text/enum so adding 
\f2\fs26 admin
\f1\fs24  later is one line, not a migration. No enforced delta beyond org_staff membership until billing exists to define a real boundary.\

\f0\b Owner vs. Director:
\f1\b0  Collapsed to one concept, 
\f2\fs26 director
\f1\fs24 . If a single non-removable billing contact is needed later, model it as a field on 
\f2\fs26 organizations
\f1\fs24 , not a role tier.\
\pard\pardeftab720\partightenfactor0
\cf0 \
sql\
\pard\pardeftab720\partightenfactor0
\cf3 \strokec3 create\cf4 \strokec4  \cf3 \strokec3 table\cf4 \strokec4  org_staff \cf5 \strokec5 (\cf4 \strokec4 \
  id uuid \cf3 \strokec3 primary\cf4 \strokec4  \cf3 \strokec3 key\cf4 \strokec4  \cf3 \strokec3 default\cf4 \strokec4  gen_random_uuid\cf5 \strokec5 (),\cf4 \strokec4 \
  org_id uuid not \cf6 \strokec6 null\cf4 \strokec4  \cf3 \strokec3 references\cf4 \strokec4  organizations\cf5 \strokec5 (\cf4 \strokec4 id\cf5 \strokec5 )\cf4 \strokec4  \cf3 \strokec3 on\cf4 \strokec4  \cf3 \strokec3 delete\cf4 \strokec4  \cf3 \strokec3 cascade\cf5 \strokec5 ,\cf4 \strokec4 \
  user_id uuid not \cf6 \strokec6 null\cf4 \strokec4  \cf3 \strokec3 references\cf4 \strokec4  profiles\cf5 \strokec5 (\cf4 \strokec4 id\cf5 \strokec5 )\cf4 \strokec4  \cf3 \strokec3 on\cf4 \strokec4  \cf3 \strokec3 delete\cf4 \strokec4  \cf3 \strokec3 cascade\cf5 \strokec5 ,\cf4 \strokec4 \
  role \cf3 \strokec3 text\cf4 \strokec4  not \cf6 \strokec6 null\cf4 \strokec4  \cf3 \strokec3 default\cf4 \strokec4  \cf7 \strokec7 'director'\cf5 \strokec5 ,\cf4 \strokec4 \
  invited_by uuid \cf3 \strokec3 references\cf4 \strokec4  profiles\cf5 \strokec5 (\cf4 \strokec4 id\cf5 \strokec5 ),\cf4 \strokec4 \
  created_at timestamptz not \cf6 \strokec6 null\cf4 \strokec4  \cf3 \strokec3 default\cf4 \strokec4  \cf8 \strokec8 now\cf5 \strokec5 (),\cf4 \strokec4 \
  \cf3 \strokec3 unique\cf4 \strokec4  \cf5 \strokec5 (\cf4 \strokec4 org_id\cf5 \strokec5 ,\cf4 \strokec4  user_id\cf5 \strokec5 )\cf4 \strokec4 \
\pard\pardeftab720\partightenfactor0
\cf5 \strokec5 );\cf4 \strokec4 \
\pard\pardeftab720\sa240\partightenfactor0
\cf0 \strokec2 RLS: SELECT limited to org_staff of that org (+ invited user, for pending state). All writes via SECURITY DEFINER RPCs.\
\pard\pardeftab720\sa280\partightenfactor0

\f0\b\fs28 \cf0 2. Team Creation & Staffing (Org-Scoped)\
\pard\pardeftab720\sa240\partightenfactor0

\f1\b0\fs24 \cf0 Director can create teams (
\f2\fs26 teams.org_id
\f1\fs24  set), assign staff (
\f2\fs26 team_staff
\f1\fs24 ), assign players \'97 all org-authorized.\
\pard\pardeftab720\sa240\partightenfactor0

\f0\b \cf0 New RPCs:
\f1\b0  
\f2\fs26 org_create_team(org_id, team_name, ...)
\f1\fs24 , 
\f2\fs26 org_assign_team_staff(team_id, user_id, role)
\f1\fs24 , 
\f2\fs26 org_assign_player(team_id, ...)
\f1\fs24  \'97 each checks caller is in 
\f2\fs26 org_staff
\f1\fs24  for that org.\
Unaffiliated teams (
\f2\fs26 org_id IS NULL
\f1\fs24 ) unchanged \'97 governed purely by 
\f2\fs26 team_staff
\f1\fs24 .\
\pard\pardeftab720\sa280\partightenfactor0

\f0\b\fs28 \cf0 3. Library & Equipment Scoping\
\pard\pardeftab720\sa240\partightenfactor0

\fs24 \cf0 3.1 Ownership \'97 coach-level, not team-level.
\f1\b0  Drills owned by 
\f2\fs26 owner_user_id
\f1\fs24  (coach). "Team library" is a computed view: drills authored by coaches currently on that team's 
\f2\fs26 team_staff
\f1\fs24 , unioned with anything promoted to org library. No migration needed when a coach changes teams \'97 the view recomputes.\

\f0\b 3.2 Sharing \'97 per-drill, with batch actions.
\f1\b0 \
\pard\pardeftab720\partightenfactor0
\cf0 \
sql\
\pard\pardeftab720\partightenfactor0
\cf3 \strokec3 alter\cf4 \strokec4  \cf3 \strokec3 table\cf4 \strokec4  activity_library\
  \cf3 \strokec3 add\cf4 \strokec4  \cf3 \strokec3 column\cf4 \strokec4  share_scope \cf3 \strokec3 text\cf4 \strokec4  not \cf6 \strokec6 null\cf4 \strokec4  \cf3 \strokec3 default\cf4 \strokec4  \cf7 \strokec7 'private'\cf5 \strokec5 ;\cf4 \strokec4  \cf9 \strokec9 -- 'private' | 'org'\cf4 \strokec4 \
\pard\pardeftab720\sa240\partightenfactor0

\f2\fs26 \cf0 \strokec2 private
\f1\fs24 : visible to authoring coach + current teammates via the computed view. 
\f2\fs26 org
\f1\fs24 : visible org-wide for browsing, independent of current team assignment.\uc0\u8232 Batch RPC: 
\f2\fs26 set_drill_share_scope(drill_ids uuid[], scope text)
\f1\fs24  \'97 all-or-nothing ownership check.\
\pard\pardeftab720\sa240\partightenfactor0

\f0\b \cf0 3.3 Promotion to org library \'97 fork, not reference.
\f1\b0  Director's "Copy to org library" on an 
\f2\fs26 org
\f1\fs24 -scoped drill creates a new row owned by the org (
\f2\fs26 owner_org_id
\f1\fs24  set, 
\f2\fs26 owner_user_id
\f1\fs24  null), copied at that point in time. Original stays independently editable by the coach. Two coexisting tiers: 
\f2\fs26 share_scope='org'
\f1\fs24  (lightweight visibility) vs. explicit fork (permanent canonical org copy).\

\f0\b 3.4 Cross-team browsing.
\f1\b0  Any org coach can browse other teams' 
\f2\fs26 org
\f1\fs24 -scoped drills and use them directly in practice planning \'97 read-only reference, no fork.\

\f0\b 3.5 Departure rule.
\f1\b0  Sharing scope governs persistence, not team membership. 
\f2\fs26 org
\f1\fs24 -scoped drills stay visible org-wide even if the coach leaves the team/org entirely. 
\f2\fs26 private
\f1\fs24  drills disappear from team views the moment the coach is off that team's roster. No cleanup RPC needed \'97 falls out of the design.\

\f0\b 3.6 Equipment \'97 hybrid, no forking.
\f1\b0  Org equipment (
\f2\fs26 owner_org_id
\f1\fs24 , tied to facilities, Director-managed) + coach equipment (
\f2\fs26 owner_user_id
\f1\fs24 ), unioned in the picker with own equipment sorted first. No copy-to-library step needed to use org equipment on a drill \'97 referenced directly, since equipment isn't versioned content the way drills are.\
\pard\pardeftab720\partightenfactor0
\cf0 \
sql\
\pard\pardeftab720\partightenfactor0
\cf9 \strokec9 -- equipment: owner_user_id nullable, owner_org_id nullable, exactly one set\cf4 \strokec4 \
\cf9 \strokec9 -- picker query: WHERE owner_user_id = auth.uid() OR owner_org_id = <team's org_id>, own first\cf4 \strokec4 \
\pard\pardeftab720\sa280\partightenfactor0

\f0\b\fs28 \cf0 \strokec2 4. Org Home Page\
\pard\pardeftab720\sa240\partightenfactor0

\f1\b0\fs24 \cf0 Lead content, in order: 
\f0\b (1)
\f1\b0  pending invites & member-management shortcuts, 
\f0\b (2)
\f1\b0  team roster/overview grid (quick-nav per team), 
\f0\b (3)
\f1\b0  org-wide rollup of weekly live practices run (reuse 
\f2\fs26 /admin/metrics
\f1\fs24  infra). Deferred: org-library activity feed (revisit once there's real volume).\
\pard\pardeftab720\sa280\partightenfactor0

\f0\b\fs28 \cf0 5. Coach Invite Flow\
\pard\pardeftab720\sa240\partightenfactor0

\f1\b0\fs24 \cf0 Email-based pending invite, auto-attach on signup/login.\
\pard\tx220\tx720\pardeftab720\li720\fi-720\partightenfactor0
\ls2\ilvl0\cf0 \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	1	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Director enters coach email 
\f4 \uc0\u8594 
\f1  
\f2\fs26 org_invites
\f1\fs24  row (
\f2\fs26 org_id
\f1\fs24 , 
\f2\fs26 email
\f1\fs24 , 
\f2\fs26 invited_by
\f1\fs24 , 
\f2\fs26 status
\f1\fs24 , optional 
\f2\fs26 team_id
\f1\fs24  for pre-assignment).\
\pard\tx220\tx720\pardeftab720\li720\fi-720\partightenfactor0
\ls2\ilvl0
\f0\b \cf0 \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	2	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Open question:
\f1\b0  does invite-time let Director pre-select team(s), or is that always post-acceptance? Recommend supporting both.\
\pard\tx220\tx720\pardeftab720\li720\fi-720\partightenfactor0
\ls2\ilvl0\cf0 \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	3	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Existing account: surfaced on next login, accept creates 
\f2\fs26 org_staff
\f1\fs24  (+ 
\f2\fs26 team_staff
\f1\fs24  if pre-assigned).\
\ls2\ilvl0\kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	4	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 No account: invite persists, fires on signup with matching email.\
\pard\pardeftab720\sa240\partightenfactor0

\f0\b \cf0 RPCs:
\f1\b0  
\f2\fs26 org_invite_coach(org_id, email, team_id?)
\f1\fs24  (Director-only), 
\f2\fs26 accept_org_invite(invite_id)
\f1\fs24  \'97 caller's 
\f2\fs26 auth.jwt()
\f1\fs24  email must match invite email server-side, never client-asserted.\
\pard\pardeftab720\sa280\partightenfactor0

\f0\b\fs28 \cf0 6. Deferred to Later Phase\
\pard\tx220\tx720\pardeftab720\li720\fi-720\partightenfactor0
\ls3\ilvl0
\f1\b0\fs24 \cf0 \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Admin role definition (needs billing to exist first)\
\ls3\ilvl0\kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Owner/billing-contact distinction\
\ls3\ilvl0\kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Invite-time team pre-assignment decision\
\ls3\ilvl0\kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Org library activity feed\
\ls3\ilvl0\kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Behavior of org-owned library content if the forking Director's account is later removed (should be unaffected \'97 
\f2\fs26 owner_org_id
\f1\fs24 -scoped, not user-scoped \'97 but write an explicit test)\
\pard\pardeftab720\sa280\partightenfactor0

\f0\b\fs28 \cf0 7. Testing Checklist\
\pard\tx220\tx720\pardeftab720\li720\fi-720\partightenfactor0
\ls4\ilvl0
\f1\b0\fs24 \cf0 \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Non-org-staff user can't call 
\f2\fs26 org_*
\f1\fs24  RPCs for an org they're not in\
\ls4\ilvl0\kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Team A coach can't see Team B coach's 
\f2\fs26 private
\f1\fs24  drills\
\pard\tx220\tx720\pardeftab720\li720\fi-720\partightenfactor0
\ls4\ilvl0
\f2\fs26 \cf0 \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 org
\f1\fs24 -scoped drills stay visible after authoring coach leaves all teams\
\pard\tx220\tx720\pardeftab720\li720\fi-720\partightenfactor0
\ls4\ilvl0\cf0 \kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Org-library fork is independently editable from the source drill, both directions\
\ls4\ilvl0\kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Batch share RPC is all-or-nothing on ownership\
\ls4\ilvl0\kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Equipment picker unions own+org, own first, scoped to current team's org only\
\ls4\ilvl0\kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Invite acceptance email match is server-side, not client-asserted\
\ls4\ilvl0\kerning1\expnd0\expndtw0 \outl0\strokewidth0 {\listtext	\uc0\u8226 	}\expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 Director-who-also-coaches-elsewhere has correct scoping in both contexts, no bleed-through\
}