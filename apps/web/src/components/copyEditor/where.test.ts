// Live text editor: where a text lives, in plain words. Run by `npm run test:copy`.
import { describe, expect, it } from 'vitest';
import { whereLabel } from './where.ts';

const key = (scope: string) => `${scope}#00000000`;

describe('where a text lives, for people', () => {
  it('names screens plainly, never by their file', () => {
    expect(whereLabel(key('pages/EventPage'), 'EventPage › h1')).toBe('Event page › title');
    expect(whereLabel(key('pages/EventForm'), 'EventFormInner › Field label')).toBe('Event form › field name');
    expect(whereLabel(key('pages/IdeaVault'), 'IdeaVault › p')).toBe('Idea vault page › text');
    expect(whereLabel(key('components/ui'), 'ui › button')).toBe('Everywhere › button');
    expect(whereLabel(key('srv'), 'Server message')).toBe('Message from the server');
    expect(whereLabel(key('srv'), 'Server text (copy)')).toBe('Message from the server › notification or sign');
    expect(whereLabel(key('shared/vocabulary'), 'LORACLE_LINES.cast')).toBe('Word list › list of words');
    expect(whereLabel(key('pages/Home'))).toBe('Home');
  });

  it('says what kind of text it is', () => {
    expect(whereLabel(key('components/report'), 'ReportSheet › div aria-label')).toBe('Report sheet › label for screen readers');
    expect(whereLabel(key('pages/Notes'), 'Notes › textarea placeholder')).toBe('Notes page › hint in a box');
    expect(whereLabel(key('pages/Calendar'), 'Calendar › button title')).toBe('Calendar page › tooltip');
    expect(whereLabel(key('pages/Profile'), 'Profile › confirm')).toBe('Profile › confirm dialog');
    expect(whereLabel(key('lib/dates'), 'dates › copy()')).toBe('Dates and times');
    expect(whereLabel(key('components/loracle'), 'Backronym › copy.list()')).toBe('The Loracle');
    expect(whereLabel(key('pages/Legal'), 'PrivacyPage › li')).toBe('Terms and Privacy › list item');
    expect(whereLabel(key('lib/theme'), 'THEME_LABELS.map')).toBe('Looks › list of words');
    expect(whereLabel(key('pages/Crew'), 'CrewPage › TopBar title')).toBe('Crew page › top bar title');
  });
});
