import { motion, useReducedMotion } from 'motion/react';
import { motionTokens } from '../../motion/tokens';
import React from 'react';
import { ShieldCheck, PiggyBank } from 'lucide-react';
import { BudgetOverview } from '../../types';

interface BudgetTabProps {
  budget: BudgetOverview | null;
}

export const BudgetTab: React.FC<BudgetTabProps> = ({ budget }) => {
  const reduced = useReducedMotion();
  if (!budget) {
    return (
      <div className="flex flex-col items-center justify-center p-12 rounded-2xl bg-surface-container border border-surface-container-highest/60 text-center space-y-3">
        <div className="w-12 h-12 rounded-xl bg-tertiary/10 text-tertiary flex items-center justify-center">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-on-surface">No budget data yet</h3>
        <p className="text-xs text-on-surface-variant max-w-sm">
          Budget envelope calculations will appear once an active expedition is loaded.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-space-md animate-in fade-in duration-200">
      <p className="text-sm text-on-surface-variant">{budget.notes || "Incomplete estimate. Confirm food, transport, and other costs with providers."}</p>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-on-surface">
            Autonomous Budget Auditor
          </h2>
          <p className="text-xs text-on-surface-variant">
            Target Envelope: {budget.currencySymbol}{budget.totalBudget.toLocaleString()} for {budget.travelersCount || 2} {(budget.travelersCount === 1) ? 'Traveler' : 'Travelers'}
          </p>
        </div>
        <span className="px-3 py-1 rounded-full bg-tertiary/15 text-tertiary text-xs font-semibold flex items-center gap-1.5 self-start sm:self-auto border border-tertiary/25">
          <ShieldCheck className="w-4 h-4" />
          <span>Within Envelope</span>
        </span>
      </div>

      {/* Overall Consumption Card */}
      <div className="rounded-xl bg-surface-container p-space-md shadow-md space-y-space-md border border-surface-container-highest/40">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider block">
              Known-cost subtotal
            </span>
            <div className="text-2xl sm:text-3xl font-bold text-on-surface mt-0.5">
              {budget.currencySymbol}{budget.allocatedExpenditure.toLocaleString()}{' '}
              <span className="text-sm sm:text-base text-on-surface-variant font-normal">
                / {budget.currencySymbol}{budget.totalBudget.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <span className="text-xl sm:text-2xl font-bold text-tertiary">
              {budget.consumptionPercentage}%
            </span>
            <div className="text-xs text-outline font-medium">
              {budget.currencySymbol}{budget.unallocatedBuffer.toLocaleString()} Unallocated Safety Buffer
            </div>
          </div>
        </div>

        {/* Segmented Progress Bar */}
        <div className="w-full h-3 rounded-full bg-surface-container-lowest overflow-hidden flex shadow-inner border border-surface-container-highest/40">
          {budget.breakdown.map((item, idx) => {
            const bgClass = {
              primary: 'bg-primary',
              tertiary: 'bg-tertiary',
              secondary: 'bg-secondary',
              'primary-container': 'bg-primary-container',
              outline: 'bg-outline',
            }[item.colorName] || 'bg-primary';
            return (
              <motion.div
                initial={reduced ? false : { width: 0 }}
                animate={{ width: `${item.percentage}%` }}
                transition={{ duration: reduced ? 0 : motionTokens.overlay, ease: motionTokens.ease }}
                data-budget-segment
                key={item.category || `prog-${idx}`}
                className={`h-full ${bgClass}`}
                title={`${item.category}: ${budget.currencySymbol}${item.allocatedAmount.toLocaleString()}`}
              />
            );
          })}
        </div>

        {/* Breakdown Badges Matrix */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
          {budget.breakdown.map((item, idx) => {
            const dotColor = {
              primary: 'bg-primary',
              tertiary: 'bg-tertiary',
              secondary: 'bg-secondary',
              'primary-container': 'bg-primary-container',
              outline: 'bg-outline',
            }[item.colorName] || 'bg-primary';

            return (
              <div
                key={item.category || `badge-${idx}`}
                className="p-space-sm rounded-lg bg-surface-container-low space-y-1 border border-surface-container-high/40"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-on-surface-variant">
                  <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
                  <span className="truncate">{item.category}</span>
                </div>
                <div className="text-sm sm:text-base font-bold text-on-surface">
                  {budget.currencySymbol}{item.allocatedAmount.toLocaleString()}
                </div>
                <div className="text-[11px] text-on-surface-variant truncate">
                  {item.sublabel}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dynamic Savings Insight */}
      <div className="p-space-md rounded-xl bg-surface-container flex items-start gap-3 border border-surface-container-highest/40">
        <div className="p-2 rounded-lg bg-tertiary/10 text-tertiary flex-shrink-0">
          <PiggyBank className="w-5 h-5" />
        </div>
        <div className="space-y-0.5">
          <h4 className="text-sm font-semibold text-on-surface">
            {budget.savingsInsightTitle}
          </h4>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {budget.savingsInsightBody}
          </p>
        </div>
      </div>
    </div>
  );
};
