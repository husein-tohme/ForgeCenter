// Whether a game is on the games page, as SQL for a games row aliased g: not taken down,
// its creator isn't suspended, and its launch order is paid with an active subscription.
// Its own module so creators.js can use it without an import loop through orders.js.
export const LIVE = `(g.hidden = 0
  AND NOT EXISTS (SELECT 1 FROM users su WHERE su.id = g.user_id AND su.suspended_at IS NOT NULL) AND EXISTS (SELECT 1 FROM orders lo WHERE lo.id = g.order_id
  AND lo.status IN ('paid', 'in_progress', 'delivered') AND lo.subscription_status = 'active'))`;
