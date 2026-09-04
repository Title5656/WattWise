'use client';

import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  displayUserName,
  householdDestinationPath,
  householdRoleLabel,
  userInitials,
  type CurrentUser,
  type HouseholdDestination,
  type HouseholdMembership,
} from '@/lib/household-ui';

export function HouseholdIdentityBar({
  user,
  household,
  households,
  destination,
}: {
  user: CurrentUser;
  household: HouseholdMembership;
  households: HouseholdMembership[];
  destination: HouseholdDestination;
}) {
  const router = useRouter();

  return <div className="header-actions">
    <label className="household-switcher">
      <span>สลับบ้าน</span>
      <select
        aria-label="เลือกบ้าน"
        value={household.id}
        onChange={(event) => router.push(householdDestinationPath(event.target.value, destination))}
      >
        {households.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
      </select>
    </label>
    <Button variant="ghost" size="icon" className="notify" aria-label="การแจ้งเตือน"><Bell aria-hidden="true" /><i /></Button>
    <div className="profile" aria-label={`${displayUserName(user)} · ${household.name} · ${householdRoleLabel(household.role)}`}>
      <i>{userInitials(user)}</i><span><b>{household.name}</b><small>{displayUserName(user)} · {householdRoleLabel(household.role)}</small></span>
    </div>
  </div>;
}
