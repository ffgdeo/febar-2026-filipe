import { analytics, createApp, genie, lakebase, server } from '@databricks/appkit';
import { setupPromoFlowRoutes } from './routes/lakebase/promoflow-routes';

createApp({
  plugins: [
    analytics({}),
    lakebase(),
    genie({ spaces: { default: process.env.DATABRICKS_GENIE_SPACE_ID ?? '' } }),
    server(),
  ],
  async onPluginsReady(appkit) {
    await setupPromoFlowRoutes(appkit);
  },
}).catch(console.error);
