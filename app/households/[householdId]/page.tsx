import { HouseholdDashboard } from '../../components/HouseholdDashboard';

export default async function HouseholdDashboardPage({ params }: { params: Promise<{ householdId: string }> }) {
  const { householdId } = await params;
  return <HouseholdDashboard householdId={householdId} />;
}
