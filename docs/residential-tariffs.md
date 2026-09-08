# Residential tariff audit — 8 September 2026

WattWise estimates normal residential PEA 1.1.1 / 1.1.2 and MEA 1.1 / 1.2 bills.
Select the account class printed on the bill in household settings. PEA and MEA
use the same energy tiers and service charges for these corresponding classes.
An unset class retains the standard estimate and displays an assumption notice.
Do not infer account class from one month's appliance estimate: meter size and
the utility's consumption-history rules determine the registered class.

## Verified schedules

Before September 2026, the low-use energy tiers end at 15, 25, 35, 100, 150,
400 kWh, then remain open-ended, at 2.3488, 2.9882, 3.2405, 3.6237, 3.7171,
4.2218, and 4.4217 THB/kWh. Standard: 150 / 400 / remaining kWh at
3.2484 / 4.2218 / 4.4217 THB/kWh.

From September 2026, low-use tiers end at 15 / 25 / 200 / 400 kWh, then
remain open-ended, at 2.3488 / 2.9882 / 3 / 4.1584 / 4.3583 THB/kWh.
Standard: 200 / 400 / remaining kWh at 3 / 4.1584 / 4.3583 THB/kWh.
Monthly service charges are 8.19 THB for low-use and 24.62 THB for standard.
Ft is 0.0972 THB/kWh for January–April 2026 and 0.1623 for May–December 2026.

Energy is accumulated across tiers. Energy charge, service charge, and Ft are
rounded to satang; VAT is 7% of their sum, rounded to satang. Negative Ft must
reduce the bill and its VAT base. For example, September standard 200 kWh:
600 + 24.62 + 32.46 + 46.00 VAT = **703.08 THB**.
The same usage under the low-use account is **674.91 THB**, before assistance.

## Sources

- [PEA tariff schedules](https://www.pea.co.th/our-services/tariff)
- [PEA September 2026 announcement](https://www.pea.co.th/news/corporate-news/2392)
- [PEA Ft statistics](https://www.pea.co.th/our-services/tariff/ft-statistics)
- [ERC published residential rates, fees and meter classification rules](https://www.erc.or.th/th/tariff/1288)
- [MEA September 2026 announcement relayed by the Government Contact Center](https://gnews2026.gcc.go.th/การไฟฟ้านครหลวง-ปรับปรุ/)
- [Government Public Relations Department: September 2026 rate changes](https://radiophitsanulok.prd.go.th/th/content/category/detail/id/2978/iid/531637)

MEA's own tariff page rejected direct access during the audit; the regulator's
table and the government relay of MEA's announcement were used for comparison.

## Limits

These are appliance-based estimates before free-electricity eligibility,
welfare credits, or individual discounts. TOU and other tariff products are
outside this normal residential calculator. Historical estimates remain as
recorded; changing the account class affects new estimates. Dates outside the
known 2026 schedules use an explicitly warned fallback, not a claimed current Ft.
The nullable migration `0012_cool_cardiac.sql` must be applied before running
this version against an existing database.

Regression coverage includes both providers, tier boundaries, Bangkok's billing
date boundary, previous tariffs, negative Ft, class persistence, home saves,
dashboard reads, monthly history, and the real D1 migration chain.
