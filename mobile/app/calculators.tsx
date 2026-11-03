import { useMemo, useState } from "react";
import { View } from "react-native";
import { Card, Chips, Field, Row, Screen, Stat, Txt } from "@/components/ui";
import { FREQUENCIES, Freq, fdRequiredPrincipal, fixedDeposit, rdRequiredDeposit, recurringDeposit } from "@/lib/deposits";
import { inr, useTheme } from "@/theme";

// The maths is the same file the website uses (synced from frontend/lib/deposits.ts).
export default function Calculators() {
  const t = useTheme();
  const [kind, setKind] = useState<"fd" | "rd">("fd");
  const [amount, setAmount] = useState("100000");
  const [monthly, setMonthly] = useState("5000");
  const [rate, setRate] = useState("7");
  const [years, setYears] = useState("5");
  const [months, setMonths] = useState("0");
  const [freq, setFreq] = useState<Freq>(4);
  const [payout, setPayout] = useState<0 | Freq>(0);
  const [tax, setTax] = useState("0");
  const [inflation, setInflation] = useState("5");
  const [target, setTarget] = useState("500000");

  const total = Math.round(Number(years || 0) * 12 + Number(months || 0));
  const common = { ratePct: Number(rate), months: total, freq, taxSlabPct: Number(tax), inflationPct: Number(inflation) };
  const r = useMemo(() => kind === "fd" ? fixedDeposit({ ...common, principal: Number(amount), payoutPerYear: payout }) : recurringDeposit({ ...common, monthly: Number(monthly) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, amount, monthly, rate, total, freq, payout, tax, inflation]);
  const planner = kind === "rd" ? rdRequiredDeposit(Number(target), Number(rate), total, freq) : fdRequiredPrincipal(Number(target), Number(rate), total, freq);

  return (
    <Screen>
      <Chips value={kind} onChange={setKind} options={[{ value: "fd", label: "Fixed deposit" }, { value: "rd", label: "Recurring deposit" }]} />
      <Card style={{ gap: 10 }}>
        {kind === "fd" ? <Field label="Deposit amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /> : <Field label="Monthly deposit (₹)" value={monthly} onChangeText={setMonthly} keyboardType="decimal-pad" />}
        <Field label="Interest rate (% a year)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
        <Row style={{ flexWrap: "nowrap" }}>
          <View style={{ flex: 1 }}><Field label="Years" value={years} onChangeText={setYears} keyboardType="number-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Months" value={months} onChangeText={setMonths} keyboardType="number-pad" /></View>
        </Row>
        <View style={{ gap: 6 }}><Txt size={12} muted weight="600">Interest compounds</Txt><Chips value={freq} onChange={setFreq} options={FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))} /></View>
        {kind === "fd" && <View style={{ gap: 6 }}><Txt size={12} muted weight="600">Interest option</Txt>
          <Chips value={payout} onChange={setPayout} options={[{ value: 0, label: "Cumulative" }, { value: 12, label: "Monthly payout" }, { value: 4, label: "Quarterly payout" }, { value: 1, label: "Yearly payout" }] as { value: 0 | Freq; label: string }[]} /></View>}
        <Row style={{ flexWrap: "nowrap" }}>
          <View style={{ flex: 1 }}><Field label="Tax slab on interest (%)" value={tax} onChangeText={setTax} keyboardType="number-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Inflation (% a year)" value={inflation} onChangeText={setInflation} keyboardType="decimal-pad" /></View>
        </Row>
      </Card>
      {r ? (
        <>
          <Row><Stat label={r.payoutPerPeriod != null ? "Principal returned" : "Maturity value"} value={inr(r.maturity, 2)} /><Stat label="Total interest" value={inr(r.interest, 2)} tone="success" sub={r.payoutPerPeriod != null ? `${inr(r.payoutPerPeriod, 2)} per payout` : undefined} /></Row>
          <Row><Stat label={kind === "rd" ? "Total deposited" : "Invested"} value={inr(r.invested, 2)} /><Stat label="Effective yield" value={`${r.effectiveYieldPct.toFixed(2)}%`} /></Row>
          <Row><Stat label="Value after tax" value={inr(r.postTaxMaturity, 2)} /><Stat label="In today's money" value={inr(r.realMaturity, 2)} /></Row>
          <Card style={{ padding: 4 }}>
            <Txt weight="600" style={{ padding: 10 }}>Year by year</Txt>
            {r.schedule.map((y) => (
              <View key={y.year} style={{ flexDirection: "row", justifyContent: "space-between", padding: 10, borderTopWidth: 1, borderColor: t.border }}>
                <Txt size={13}>{y.label}</Txt><Txt size={13} color={t.success}>+{inr(y.interest)}</Txt><Txt size={13} weight="600">{inr(y.balance)}</Txt>
              </View>
            ))}
          </Card>
        </>
      ) : <Card><Txt size={13} muted>Enter an amount, a rate between 0 and 40%, and a tenure of 1 to 600 months.</Txt></Card>}
      <Card style={{ gap: 8 }}>
        <Txt weight="700">Goal planner</Txt>
        <Field label="Target amount at maturity (₹)" value={target} onChangeText={setTarget} keyboardType="decimal-pad" />
        <Txt size={13} muted>{kind === "rd" ? "Deposit each month" : "Deposit today"}</Txt>
        <Txt size={24} weight="700" color={t.primary}>{planner ? inr(planner, 2) : "—"}</Txt>
      </Card>
      <Txt size={11} muted style={{ textAlign: "center" }}>Estimates only. Banks differ in compounding, rounding and tax rules. Not financial advice.</Txt>
    </Screen>
  );
}
