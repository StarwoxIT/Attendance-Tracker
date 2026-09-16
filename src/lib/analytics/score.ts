export interface AttendanceCounts {
  early: number;
  onTime: number;
  late: number;
  missedClockOut: number;
}

export interface ScoreWeights {
  earlyPoints: number;
  onTimePoints: number;
  /** Penalty magnitude subtracted per late day — NOT added. A value of 3 means 3
   * points deducted, not 3 points awarded. */
  latePoints: number;
  /** Penalty magnitude subtracted per day the employee didn't clock out. */
  missedClockOutPoints: number;
}

export interface AttendanceScore {
  markedDays: number;
  /** Gross points earned from early/on-time days, before penalties. */
  grossPoints: number;
  /** Total penalty points deducted for late days and missed clock-outs. */
  penaltyPoints: number;
  /** grossPoints - penaltyPoints. */
  netPoints: number;
  /** netPoints / markedDays — 0 when there are no marked days. */
  averagePoints: number;
  /** averagePoints expressed as a % of the best possible per-day score, floored at
   * 0 (penalties can push net points negative, but a score can't go below 0%). An
   * employee who was early every day always scores 100 regardless of the weights. */
  percentage: number;
}

/**
 * Weighted daily-average performance score. Each attended day earns points for
 * arriving early or on time (weights configurable in Attendance Settings,
 * defaulting to early=5 / on-time=3), while a late arrival or a missed clock-out
 * SUBTRACTS a configurable penalty instead of merely earning fewer points — a
 * consistently late employee can score 0%, not just "less than early." Averaging
 * over days actually marked (not absences) keeps someone who simply has fewer
 * working days from being penalized for a smaller sample size.
 */
export function computeAttendanceScore(counts: AttendanceCounts, weights: ScoreWeights): AttendanceScore {
  const markedDays = counts.early + counts.onTime + counts.late + counts.missedClockOut;
  const grossPoints = counts.early * weights.earlyPoints + counts.onTime * weights.onTimePoints;
  const penaltyPoints = counts.late * weights.latePoints + counts.missedClockOut * weights.missedClockOutPoints;
  const netPoints = grossPoints - penaltyPoints;
  const averagePoints = markedDays > 0 ? netPoints / markedDays : 0;
  const bestPossiblePerDay = Math.max(weights.earlyPoints, weights.onTimePoints, 1);
  const percentage = markedDays > 0 ? Math.max(0, (averagePoints / bestPossiblePerDay) * 100) : 0;

  return { markedDays, grossPoints, penaltyPoints, netPoints, averagePoints, percentage };
}
