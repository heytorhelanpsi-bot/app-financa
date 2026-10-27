import { describe, expect, it } from 'vitest';
import { normalizeSupabaseUrl } from './supabase';

describe('normalizeSupabaseUrl', () => {
  it('usa apenas a origem do projeto', () => {
    expect(normalizeSupabaseUrl('https://abc.supabase.co/rest/v1/')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseUrl(' https://abc.supabase.co/ ')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseUrl('https://abc.supabase.co')).toBe('https://abc.supabase.co');
  });

  it('rejeita valores inválidos', () => {
    expect(normalizeSupabaseUrl('abc.supabase.co')).toBeUndefined();
    expect(normalizeSupabaseUrl('')).toBeUndefined();
  });
});
