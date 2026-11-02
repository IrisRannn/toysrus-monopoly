-- Trusted Express backend is the sole writer. Run as the database owner.
-- All mutations use BEGIN + advisory transaction lock + SELECT FOR UPDATE.
BEGIN;
CREATE TABLE IF NOT EXISTS public.game_rooms (
 code text PRIMARY KEY CHECK (code ~ '^[0-9]{6}$'),
 version bigint NOT NULL CHECK(version >= 1),
 state jsonb NOT NULL,
 status text GENERATED ALWAYS AS (state->>'status') STORED,
 current_team text GENERATED ALWAYS AS (state->>'currentTeam') STORED,
 current_round integer GENERATED ALWAYS AS ((state->>'round')::integer) STORED
);
CREATE TABLE IF NOT EXISTS public.teams (
 id text PRIMARY KEY, room_code text NOT NULL REFERENCES public.game_rooms(code) ON DELETE CASCADE,
 data jsonb NOT NULL,
 team_key text GENERATED ALWAYS AS (data->>'id') STORED,
 name text GENERATED ALWAYS AS (data->>'name') STORED,
 color text GENERATED ALWAYS AS (data->>'color') STORED,
 position integer GENERATED ALWAYS AS ((data->>'position')::integer) STORED CHECK(position BETWEEN 0 AND 20),
 finish_order integer GENERATED ALWAYS AS ((data->>'finishOrder')::integer) STORED,
 finished_at bigint GENERATED ALWAYS AS ((data->>'finishedAt')::bigint) STORED
);
CREATE TABLE IF NOT EXISTS public.players (
 id text PRIMARY KEY, room_code text NOT NULL REFERENCES public.game_rooms(code) ON DELETE CASCADE,
 data jsonb NOT NULL,
 nickname text GENERATED ALWAYS AS (data->>'nickname') STORED,
 team_key text GENERATED ALWAYS AS (data->>'team') STORED,
 removed boolean GENERATED ALWAYS AS ((data->>'removed')::boolean) STORED
);
CREATE TABLE IF NOT EXISTS public.questions (
 id text PRIMARY KEY, room_code text NOT NULL REFERENCES public.game_rooms(code) ON DELETE CASCADE,
 data jsonb NOT NULL,
 tile integer GENERATED ALWAYS AS ((data->>'tile')::integer) STORED CHECK(tile IN (4,8,12,15,16)),
 question text GENERATED ALWAYS AS (data->>'text') STORED,
 correct_answer text GENERATED ALWAYS AS (data->>'answer') STORED CHECK(correct_answer IN ('A','B','C','D'))
);
CREATE TABLE IF NOT EXISTS public.answers (
 id text PRIMARY KEY, room_code text NOT NULL REFERENCES public.game_rooms(code) ON DELETE CASCADE,
 data jsonb NOT NULL,
 quiz_id text GENERATED ALWAYS AS (data->>'quizId') STORED,
 player_id text GENERATED ALWAYS AS (data->>'playerId') STORED,
 question_id text GENERATED ALWAYS AS (data->>'questionId') STORED,
 option text GENERATED ALWAYS AS (data->>'option') STORED CHECK(option IN ('A','B','C','D')),
 submitted_at bigint GENERATED ALWAYS AS ((data->>'at')::bigint) STORED,
 UNIQUE(room_code,quiz_id,player_id)
);
CREATE TABLE IF NOT EXISTS public.game_events (
 id text PRIMARY KEY, room_code text NOT NULL REFERENCES public.game_rooms(code) ON DELETE CASCADE,
 data jsonb NOT NULL, before_state jsonb, after_state jsonb,
 event_type text GENERATED ALWAYS AS (data->>'type') STORED,
 actor text GENERATED ALWAYS AS (data->>'actor') STORED,
 happened_at bigint GENERATED ALWAYS AS ((data->>'at')::bigint) STORED
);
CREATE TABLE IF NOT EXISTS public.game_turns (
 id text PRIMARY KEY, room_code text NOT NULL REFERENCES public.game_rooms(code) ON DELETE CASCADE,
 data jsonb NOT NULL,
 turn_number integer GENERATED ALWAYS AS ((data->>'turnId')::integer) STORED,
 team_key text GENERATED ALWAYS AS (data->>'team') STORED,
 phase text GENERATED ALWAYS AS (data->>'phase') STORED,
 dice integer GENERATED ALWAYS AS ((data->'dice'->>'value')::integer) STORED CHECK(dice BETWEEN 1 AND 6)
);
CREATE INDEX IF NOT EXISTS teams_room_idx ON public.teams(room_code);
CREATE INDEX IF NOT EXISTS players_room_idx ON public.players(room_code);
CREATE INDEX IF NOT EXISTS questions_room_idx ON public.questions(room_code,tile);
CREATE INDEX IF NOT EXISTS answers_room_idx ON public.answers(room_code,quiz_id);
CREATE INDEX IF NOT EXISTS events_room_idx ON public.game_events(room_code,happened_at);
CREATE INDEX IF NOT EXISTS turns_room_idx ON public.game_turns(room_code,turn_number);
ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_turns ENABLE ROW LEVEL SECURITY;
-- No public SELECT policies: even the question answer and host hashes stay private.
REVOKE ALL ON public.game_rooms,public.teams,public.players,public.questions,public.answers,public.game_events,public.game_turns FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public.game_rooms,public.teams,public.players,public.questions,public.answers,public.game_events,public.game_turns FROM %I',r);
  END IF;
 END LOOP;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN
  GRANT ALL ON public.game_rooms,public.teams,public.players,public.questions,public.answers,public.game_events,public.game_turns TO service_role;
 END IF;
END $$;
COMMIT;
