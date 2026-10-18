import { Link } from 'react-router';
import { Empty, TopBar } from '../components/ui.tsx';

export function NotFound() {
  return (
    <>
      <TopBar back />
      <Empty title="This page isn’t part of the story.">
        <Link to="/" className="btn btn-secondary btn-sm">
          Go home
        </Link>
      </Empty>
    </>
  );
}
