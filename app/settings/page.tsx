import { SettingsPage } from '../components/AccountPages';

export default function Page() { return <SettingsPage logoutEnabled={!import.meta.env.DEV} />; }
