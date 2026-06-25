# Position Sizing Playbook

## Purpose
Calculates the optimal number of shares or lots to trade based on the defined Risk Gate parameters.

## Formula
Position Size = (Account Capital * Risk %) / (Entry Price - Stop Loss Price)

## Constraints
- Max position size is 25% of total account capital per trade.
- Cap risk per trade at 1% of total account capital.
- Account for minimum lot sizes in F&O.

## Actionable Checks
If a user asks for a trade plan, output the exact quantity they should consider, along with the math used.
