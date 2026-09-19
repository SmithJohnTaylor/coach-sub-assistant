import { useRoute } from './router';
import { Teams } from './screens/Teams';
import { TeamPage } from './screens/TeamPage';
import { GameSetup } from './screens/GameSetup';
import { GameScreen } from './screens/GameScreen';
import { Season } from './screens/Season';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <Teams />;
    case 'team':
      return <TeamPage key={route.teamId} teamId={route.teamId} />;
    case 'newGame':
      return <GameSetup key={route.teamId} teamId={route.teamId} />;
    case 'game':
      return <GameScreen key={route.gameId} gameId={route.gameId} />;
    case 'season':
      return <Season key={route.teamId} teamId={route.teamId} />;
  }
}
