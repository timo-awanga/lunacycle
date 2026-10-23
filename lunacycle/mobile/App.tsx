import React, { useEffect, useState } from 'react';
import { SafeAreaView, Text, TextInput, Pressable, View, StyleSheet, ActivityIndicator } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Set EXPO_PUBLIC_API_URL to your deployed HTTPS API (use your computer's LAN IP when testing locally).
const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
type Logs = Record<string, { flow?: number }>;
type Data = { user: { display_name: string | null }; logs: Logs };

async function call(path: string, token?: string, body?: unknown) {
  const r = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Request failed');
  return j;
}
const day = (s: string, n: number) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10);

function cycleDay(logs: Logs): { start: string; day: number } | null {
  const flow = Object.keys(logs).filter((d) => logs[d].flow).sort();
  const start = [...flow].reverse().find((d) => !logs[day(d, -1)]?.flow);
  return start ? { start, day: Math.floor((Date.now() - Date.parse(start)) / 864e5) + 1 } : null;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  const load = async (t: string) => {
    try { setData(await call('/api/data', t)); setToken(t); }
    catch { await SecureStore.deleteItemAsync('token'); setToken(null); }
  };
  useEffect(() => { (async () => { const t = await SecureStore.getItemAsync('token'); if (t) await load(t); setBusy(false); })(); }, []);

  const login = async () => {
    setErr(''); setBusy(true);
    try { const j = await call('/api/auth/login', undefined, { email, password }); await SecureStore.setItemAsync('token', j.token); await load(j.token); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const logout = async () => { if (token) await call('/api/auth/logout', token, {}).catch(() => {}); await SecureStore.deleteItemAsync('token'); setToken(null); setData(null); };

  if (busy) return <SafeAreaView style={s.c}><ActivityIndicator /></SafeAreaView>;
  if (!token || !data) return (
    <SafeAreaView style={s.c}>
      <Text style={s.h1}>🌙 LunaCycle</Text>
      <TextInput style={s.in} placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={s.in} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Pressable style={s.btn} onPress={login}><Text style={s.bt}>Log in</Text></Pressable>
      <Text style={s.note}>Create your account on the website first.</Text>
    </SafeAreaView>
  );
  const cd = cycleDay(data.logs);
  return (
    <SafeAreaView style={s.c}>
      <Text style={s.h1}>Hello{data.user.display_name ? `, ${data.user.display_name}` : ''}</Text>
      <View style={s.card}>
        <Text style={s.note}>Current cycle day</Text>
        <Text style={s.big}>{cd ? cd.day : '—'}</Text>
        <Text style={s.note}>{cd ? `Period started ${cd.start}` : 'Log a period on the website to begin.'}</Text>
      </View>
      <Text style={s.note}>For tracking and education only. Not medical advice.</Text>
      <Pressable onPress={logout}><Text style={s.link}>Log out</Text></Pressable>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  c: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#f6f3ee' },
  h1: { fontSize: 28, fontWeight: '600', color: '#7b4b94', marginBottom: 16 },
  in: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e8e2d8' },
  btn: { backgroundColor: '#7b4b94', borderRadius: 999, padding: 14, alignItems: 'center', marginTop: 6 },
  bt: { color: '#fff', fontWeight: '600' }, err: { color: '#d9576b', marginBottom: 6 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 22, alignItems: 'center', marginBottom: 14 },
  big: { fontSize: 64, fontWeight: '600', color: '#7b4b94' }, note: { color: '#7a7690', fontSize: 13, textAlign: 'center' },
  link: { color: '#7b4b94', textAlign: 'center', marginTop: 16 },
});
