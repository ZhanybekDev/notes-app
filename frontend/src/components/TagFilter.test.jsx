import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TagFilter from './TagFilter.jsx';

function renderWithLang(ui) {
  return render(ui);
}

describe('TagFilter', () => {
  it('renders nothing when there are no tags', () => {
    const { container } = renderWithLang(
      <TagFilter tags={[]} active={null} onChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an "all" chip plus one per tag and marks the active one', () => {
    renderWithLang(
      <TagFilter tags={['work', 'ideas']} active="work" onChange={() => {}} />
    );

    expect(screen.getByText('all')).toBeInTheDocument();
    expect(screen.getByText('#work')).toHaveClass('active');
    expect(screen.getByText('#ideas')).not.toHaveClass('active');
  });

  it('invokes onChange with the tag when a chip is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithLang(
      <TagFilter tags={['work', 'ideas']} active={null} onChange={onChange} />
    );

    await user.click(screen.getByText('#ideas'));
    expect(onChange).toHaveBeenCalledWith('ideas');

    await user.click(screen.getByText('all'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
