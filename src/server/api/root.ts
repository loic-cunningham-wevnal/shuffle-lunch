import { router } from "./trpc";
import { membersRouter } from "./routers/members";
import { profilesRouter } from "./routers/profiles";
import { pairHistoryRouter } from "./routers/pair-history";
import { historyRouter } from "./routers/history";

export const appRouter = router({
  members: membersRouter,
  profiles: profilesRouter,
  pairHistory: pairHistoryRouter,
  history: historyRouter,
});

export type AppRouter = typeof appRouter;
