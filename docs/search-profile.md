# Apartment search profile

As of 2026-10-14, every MCP `search_apartments` call applies this mandatory profile:

- Sale only.
- Bat Yam, Azor or Holon (all three by default; `city` can narrow to one).
- Exactly 3 rooms.
- Floor 10 or higher, with highest floors first by default.
- Elevator, sun terrace and parking explicitly present in stored listing claims.

Missing, null and false required features do not qualify. A normal balcony does
not establish a sun terrace. Conflicting requests return a tool error. Broader
room or floor bounds cannot relax the profile. The response reports effective
filters, including the three-city scope.

Price, building age and registered parking remain available as additional
filters; they are not implied by the current baseline profile. Listing claims
still require independent verification before buying.

As of 2026-10-15, the scraper also applies this profile before storage: it visits
sale searches only, checks candidate details in memory, and uploads only confirmed
matches. Full runs check every candidate rather than storing broad inventory and
enriching a limited subset. Unavailable detail pages are reported and not stored.
The user requested clearing the old inventory and history for a fresh run.
The scraper is manual-only via
`workflow_dispatch`; its daily schedule was removed on 2026-10-14.
