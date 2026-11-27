---
'@market-chart/ui': patch
'@market-chart/trading': patch
---

The price-axis "+" button no longer covers an order label's × button: pointing at the × to cancel an order showed the "+" on top of it, so the click opened the price-action menu instead of cancelling. The button now stays off areas registered with `ui.reservedAreas`, and the trading overlay registers its labels.
