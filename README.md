# ovqat-rates

A relay for the **official exchange rates of the Central Bank of Azerbaijan (CBA)**, for the Ovqat app's backend.

`cbar.az` drops connections from some hosting networks, including the one the Ovqat API runs on. A GitHub Actions
workflow runs from a network that can reach it, fetches **only** `https://cbar.az/currencies/DD.MM.YYYY.xml`, checks that
the document is a real bulletin (a `ValCurs` element with a valid, recent date, at least 15 usable currencies, a plausible
USD rate) and stores it **unchanged** in `cba/latest.xml`. Nothing else is fetched, nothing is converted, no rate is
invented: if the bank cannot be reached or the document is not a bulletin, the published files stay as they were.

| File | What it is |
|---|---|
| `cba/latest.xml` | the newest valid bulletin, byte for byte as published by the bank |
| `cba/meta.json` | requested date, **effective date**, fetch time, sha256, currency count |
| `cba/archive/YYYY-MM-DD.xml` | every published bulletin, by effective date |

The effective date is the `Date` attribute inside the bulletin; the bank answers for non-working days with the previous
working day's bulletin, so the requested date is never trusted. Source: https://cbar.az (official rates page).
The data belongs to the Central Bank of Azerbaijan; this repository only relays it.
