import { createSiteConfig } from '../../core/vite.config.shared.js';
import siteConfig from './web/site.config.js';

export default createSiteConfig(import.meta.dirname, siteConfig);
