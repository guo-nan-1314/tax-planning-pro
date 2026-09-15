#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
中国个人所得税计算引擎 v1.0 (Pro版)
作者：user_7400cfba
版本：1.0.0
"""
import argparse, json, sys

TAX_BRACKETS = [
    (36000, 0.03, 0), (144000, 0.10, 2520), (300000, 0.20, 16920),
    (420000, 0.25, 31920), (660000, 0.30, 52920), (960000, 0.35, 85920),
    (float('inf'), 0.45, 181920),
]
BASIC_DEDUCTION = 60000

def calc_tax(taxable_income):
    if taxable_income <= 0: return 0.0, 0.0
    for upper, rate, qd in TAX_BRACKETS:
        if taxable_income <= upper:
            return max(taxable_income * rate - qd, 0.0), rate
    return 0.0, 0.0

def calc_comprehensive(income, insurance=0, deductions=0, other=0):
    taxable = max(0, income - BASIC_DEDUCTION - insurance - deductions - other)
    tax, rate = calc_tax(taxable)
    return {"income": income, "taxable": taxable, "rate": f"{rate*100:.0f}%",
            "tax": round(tax, 2), "after_tax": round(income - insurance - tax, 2)}

def main():
    parser = argparse.ArgumentParser(description="个税计算引擎 Pro")
    parser.add_argument("--income", type=float, required=True)
    parser.add_argument("--social-insurance", type=float, default=0)
    parser.add_argument("--deductions", type=float, default=0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    r = calc_comprehensive(args.income, args.social_insurance, args.deductions)
    print(json.dumps(r, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()