import { HouseholdMyHome } from '../../../components/HouseholdMyHome';

export default async function HouseholdMyHomePage({ params }: { params: Promise<{ householdId: string }> }) {
  const { householdId } = await params;
  return <HouseholdMyHome householdId={householdId} />;
}
