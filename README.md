# EM Solutions Audit App

Public static host for the Emergency Management Audit Monitor.

The application contains no credentials. Users must sign in to the Esri Public Safety ArcGIS Online organization through OAuth, and all data access remains governed by ArcGIS item sharing.

The application queries private control service `1bf53b90d36341e5a8f8959ee3163199` and loads private ArcGIS Web Map `960844e399eb4574a054cfb2e089ab4a` after authentication. Current source geometry is drawn as a temporary selection graphic; the web map remains the saved ArcGIS map definition.

OAuth redirect URLs:

- https://jonpedder.github.io/EM-Solutions-Audit-App/
- https://jonpedder.github.io/EM-Solutions-Audit-App/index.html
- https://jonpedder.github.io/EM-Solutions-Audit-App/oauth-callback.html

Site: https://jonpedder.github.io/EM-Solutions-Audit-App/

Settings and operator help:

- https://jonpedder.github.io/EM-Solutions-Audit-App/settings.html#configuration
- https://jonpedder.github.io/EM-Solutions-Audit-App/settings.html#help

The application follows the CA Security Ops / Mission Insights visual language, including the centered signed-out gate, navy operational surfaces, gold actions, compact panels, semantic status colors, and accessible focus states.

Authenticated users can export every audit row matching the current filters as UTF-8 CSV or generate a paginated PDF audit-trail report. Exports retain event and Workflow Manager identifiers, UTC timestamps, editor attribution, human-readable before/after values, and geometry movement metadata.

Settings are validated and stored in the current browser under `emAuditMonitor.settings.v1`. They control presentation defaults only: title, subtitle, initial date window, query page size, basemap, and visibility of the Emergency Manager Solution link. They do not modify portal permissions, source items, Notebook schedules, Workflow Manager, or audit records.
