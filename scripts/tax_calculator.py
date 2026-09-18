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
    if income < 0:
        return {"error": "收入不能为负数", "income": income}
    if insurance < 0 or deductions < 0 or other < 0:
        return {"error": "扣除项不能为负数"}
    taxable = max(0, income - BASIC_DEDUCTION - insurance - deductions - other)
    tax, rate = calc_tax(taxable)
    return {"income": income, "taxable": taxable, "rate": f"{rate*100:.0f}%",
            "tax": round(tax, 2), "after_tax": round(income - insurance - tax, 2)}

def format_table(r):
    """人类可读表格输出（默认模式）"""
    if "error" in r:
        return f"错误: {r['error']}"
    lines = [
        "+--------------------------------------+",
        "|       个人所得税计算结果              |",
        "+--------------------------------------+",
        f"|  年收入:       {r['income']:>12,.2f} 元       |",
        f"|  应纳税所得额: {r['taxable']:>12,.2f} 元       |",
        f"|  适用税率:     {r['rate']:>8}               |",
        f"|  应缴税额:     {r['tax']:>12,.2f} 元       |",
        f"|  税后收入:     {r['after_tax']:>12,.2f} 元       |",
        "+--------------------------------------+",
    ]
    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser(description="个税计算引擎 Pro")
    parser.add_argument("--income", type=float, required=True, help="年收入（元）")
    parser.add_argument("--social-insurance", type=float, default=0, help="五险一金月缴额")
    parser.add_argument("--deductions", type=float, default=0, help="专项附加扣除月总额")
    parser.add_argument("--json", action="store_true", help="JSON格式输出")
    args = parser.parse_args()
    r = calc_comprehensive(args.income, args.social_insurance, args.deductions)
    if args.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        print(format_table(r))

if __name__ == "__main__":
    main()
