"use client";
import { BatteryMedium, Lock, MapPin, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Async, PageHeader, SectionTitle } from "@/components/common/states";
import { StartRideButton } from "@/components/ride/parts";
import { Card, Label, Select } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import type { Bike } from "@/lib/ride";

export default function StartRide() {
  const router = useRouter();
  const bikes = useFetch<Bike[]>("/bikes");
  const [bike, setBike] = useState("");
  useEffect(() => { const d = bikes.data?.find((b) => b.is_default); if (d && !bike) setBike(String(d.id)); }, [bikes.data, bike]);

  return (
    <>
      <PageHeader title="Start a ride" sub="Pick your bike and begin recording" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Before you go" />
          <Async state={bikes}>{(list) => (
            <div className="space-y-4">
              {list.length ? (
                <div><Label>Bike</Label>
                  <Select value={bike} onChange={(e) => setBike(e.target.value)}><option value="">No bike</option>{list.map((b) => <option key={b.id} value={b.id}>{b.name}{b.registration ? ` · ${b.registration}` : ""}</option>)}</Select></div>
              ) : <p className="text-sm text-muted-foreground">No bike yet. <Link href="/ride/settings" className="text-primary">Add your bike</Link> to track mileage per bike, or just ride without one.</p>}
              <StartRideButton onClick={() => router.push(`/ride/live?start=1${bike ? `&bike=${bike}` : ""}`)} />
            </div>
          )}</Async>
        </Card>
        <Card>
          <SectionTitle title="What to expect" />
          <ul className="space-y-3 text-sm">
            <li className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><b>Location permission.</b> Your browser will ask to use your location. It's used only while a ride is recording, and your route is stored in your private account.</span></li>
            <li className="flex gap-2"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><b>Keep the screen on.</b> Mount your phone, open this page, and keep the screen awake (we request a wake lock). Browsers pause GPS when the screen locks or the tab is hidden, so the route will have a gap.</span></li>
            <li className="flex gap-2"><BatteryMedium className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><b>Battery.</b> Continuous GPS plus a lit screen uses power. Plug in for long rides.</span></li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><b>Private by design.</b> GPS history is never sent to the public MCP data services. You can delete rides at any time in Settings.</span></li>
            <li className="flex gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><b>Secure page needed.</b> GPS works on https or localhost only.</span></li>
          </ul>
        </Card>
      </div>
    </>
  );
}
