import { Icon } from '../common/Icon.jsx';

/**
 * Nav-rail icon for the Host settings section. Inline icon slots pass the Host nav metrics
 * ({ size, active }) straight to the contributor; the gear fallback the shell would use is a
 * poor match for the workbench, so it contributes the same explorer glyph as the panel tab.
 */
export function IdeSettingsIcon({ size = 16 }) {
  return <Icon name="explorer" size={size} />;
}
