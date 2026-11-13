import { NextRequest, NextResponse } from 'next/server';
import { getProjectById, getClipsByProjectId, deleteProject } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Project ID is required' }, { status: 400 });
    }

    const project = getProjectById(id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const clips = getClipsByProjectId(id);

    return NextResponse.json({
      success: true,
      project,
      clips,
    });
  } catch (err) {
    console.error('Error fetching project:', err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const deleteMedia = searchParams.get('deleteMedia') === 'true';

    const deleted = deleteProject(id, deleteMedia);
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Project deleted successfully' });
  } catch (err) {
    console.error('Error deleting project:', err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || 'Failed to delete project' },
      { status: 500 }
    );
  }
}
